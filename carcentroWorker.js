// carcentroWorker.js
// Worker that periodically polls CarCentro (AoooG) for real-time tracking data
// and stores coordinates + broadcasts GPS updates via WebSocket

const CarCentroService = require("./carcentroService");
const Coordinate = require("./models/coordinate");
const Vehicle = require("./models/vehicle");
const { broadcastGPSUpdate } = require("./ws-server");

class CarCentroWorker {
  constructor(config) {
    this.service = new CarCentroService(config);
    this.isRunning = false;
    this.intervalId = null;
    this.vehicleMapCache = {};
    this.loggedDevices = new Set();
    this.lastFetchTime = null;
    this.fetchCount = 0;
    this.errorCount = 0;
    this.config = config;

    // Track previous device states for change detection
    this.previousStates = {};
  }

  /**
   * Start the worker - login and begin periodic fetching
   */
  async start(intervalMs = 15000) {
    if (this.isRunning) {
      console.log("⚠ [CarCentro Worker] Already running");
      return;
    }

    console.log("🚌 [CarCentro Worker] Starting...");
    console.log(
      `   Base URL: ${this.config.baseUrl || "http://carcentro.aooog.com"}`
    );
    console.log(`   Username: ${this.config.username}`);
    console.log(`   Interval: ${intervalMs / 1000}s`);

    // Initial login
    const loginOk = await this.service.login();
    if (!loginOk) {
      console.error(
        "❌ [CarCentro Worker] Initial login failed, will retry..."
      );
    }

    this.isRunning = true;

    // First fetch immediately
    await this.fetchAndProcess();

    // Then periodic
    this.intervalId = setInterval(() => {
      this.fetchAndProcess();
    }, intervalMs);

    console.log("✅ [CarCentro Worker] Started successfully");
  }

  /**
   * Stop the worker
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log("🛑 [CarCentro Worker] Stopped");
  }

  /**
   * Main fetch-and-process cycle
   */
  async fetchAndProcess() {
    try {
      // Ensure logged in
      await this.service.ensureLoggedIn();

      // Fetch all device track data
      const devices = await this.service.fetchTrackData();

      if (!devices || devices.length === 0) {
        return;
      }

      this.fetchCount++;
      this.lastFetchTime = new Date();

      // Parse and process each device
      const parsedDevices = devices.map((d) =>
        CarCentroService.parseDeviceRecord(d)
      );

      // Save coordinates to MongoDB
      await this.saveCoordinates(parsedDevices);

      // Broadcast GPS updates via WebSocket
      await this.broadcastUpdates(parsedDevices);

      // Auto-register new vehicles
      await this.autoRegisterVehicles(parsedDevices);

      // Register devices with CarCentro video service (if available)
      if (global.__ccVideoService) {
        for (const device of parsedDevices) {
          global.__ccVideoService.registerDevice(device.deviceName, device.deviceID, device.alias);
        }
      }

      // Log summary periodically
      if (this.fetchCount % 20 === 1) {
        const moving = parsedDevices.filter(
          (d) => d.status === "moving"
        ).length;
        const idle = parsedDevices.filter(
          (d) => d.status === "idle"
        ).length;
        const parked = parsedDevices.filter(
          (d) => d.status === "parked"
        ).length;
        const offline = parsedDevices.filter(
          (d) => d.status === "offline"
        ).length;

        console.log(
          `🚌 [CarCentro] ${parsedDevices.length} devices | Moving: ${moving}, Idle: ${idle}, Parked: ${parked}, Offline: ${offline}`
        );
      }

      this.errorCount = 0; // Reset error count on success
    } catch (err) {
      this.errorCount++;
      console.error(
        `❌ [CarCentro Worker] Fetch cycle error (${this.errorCount}):`,
        err.message
      );

      // Re-login on persistent errors
      if (this.errorCount >= 3) {
        console.log("🔄 [CarCentro Worker] Too many errors, forcing re-login...");
        this.service.isLoggedIn = false;
        this.errorCount = 0;
      }
    }
  }

  /**
   * Save coordinates to MongoDB
   */
  async saveCoordinates(devices) {
    const vehicleMap = await this.getVehicleMap();

    for (const device of devices) {
      try {
        // Skip devices without GPS data
        if (!device.latitude || !device.longitude) continue;
        if (device.latitude === 0 && device.longitude === 0) continue;

        // Build vehicle name from our DB or from CarCentro alias
        const vehicleInfo = vehicleMap[device.deviceName];
        const vehicleName =
          vehicleInfo?.display_name ||
          vehicleInfo?.name ||
          device.alias ||
          device.deviceName;

        const eventTime = device.gpsDateTime
          ? new Date(device.gpsDateTime.replace(" ", "T") + "+07:00")
          : new Date();

        const coordData = {
          imei: device.deviceName, // CarCentro uses deviceName as unique ID
          device_key: `cc_${device.deviceID}`,
          vehicle_name: vehicleName,
          event_time: eventTime,
          receive_time: new Date(),
          time_zone: "+07:00",
          local_date: device.gpsDateTime
            ? device.gpsDateTime.split(" ")[0]
            : new Date().toISOString().split("T")[0],
          state: device.acc === "ON" ? 3 : 0, // 3 = ACC ON, 0 = ACC OFF
          warning: 0,
          lat: device.latitude,
          lng: device.longitude,
          speed: device.speed,
          azimuth: device.heading,
          height: 0,
          mileage: device.odometer,
          additional: {
            gsm_signal: 0,
            satellites: device.gpsAccuracy || 0,
            vehicle_signal_bit: 0,
            io: 0,
            fence_list: [],
            alarm_list: [],
          },
          properties: {
            interval: 15,
            daily_subtotal: {
              date: device.gpsDateTime
                ? device.gpsDateTime.split(" ")[0]
                : "",
              mileage: device.todayOdometer || 0,
            },
          },
        };

        // Upsert: update if same device + same event_time, insert if new
        await Coordinate.findOneAndUpdate(
          {
            imei: device.deviceName,
            event_time: eventTime,
          },
          coordData,
          { upsert: true, new: true }
        );
      } catch (err) {
        if (err.code !== 11000) {
          // Ignore duplicate key errors
          console.error(
            `❌ [CarCentro] Save coord error for ${device.alias}:`,
            err.message
          );
        }
      }
    }
  }

  /**
   * Broadcast GPS updates via WebSocket
   */
  async broadcastUpdates(devices) {
    const vehicleMap = await this.getVehicleMap();

    for (const device of devices) {
      try {
        if (!device.latitude || !device.longitude) continue;
        if (device.latitude === 0 && device.longitude === 0) continue;

        const vehicleInfo = vehicleMap[device.deviceName];
        const vehicleName =
          vehicleInfo?.display_name ||
          vehicleInfo?.name ||
          device.alias ||
          device.deviceName;

        // Log mapping once
        if (!this.loggedDevices.has(device.deviceName)) {
          console.log(
            `📋 [CarCentro] Device mapping: ${device.deviceName} → ${vehicleName} (${device.groupName})`
          );
          this.loggedDevices.add(device.deviceName);
        }

        const eventTime = device.gpsDateTime
          ? new Date(device.gpsDateTime.replace(" ", "T") + "+07:00").getTime()
          : Date.now();

        broadcastGPSUpdate(
          vehicleName,
          device.latitude,
          device.longitude,
          device.speed,
          device.heading,
          eventTime
        );
      } catch (err) {
        // Silently ignore broadcast errors
      }
    }
  }

  /**
   * Auto-register vehicles from CarCentro that aren't in our DB yet
   */
  async autoRegisterVehicles(devices) {
    for (const device of devices) {
      try {
        const existing = await Vehicle.findOne({
          imei: device.deviceName,
        });

        if (!existing) {
          // Extract bus name from alias
          let busName = device.busName || device.alias;
          // Remove special chars that might conflict with name uniqueness
          busName = busName.replace(/[^a-zA-Z0-9\s\-]/g, "").trim();

          if (!busName) busName = `CC-${device.deviceID}`;

          // Check for name conflict
          const nameConflict = await Vehicle.findOne({ name: busName });
          if (nameConflict) {
            busName = `${busName} (CC)`;
          }

          await Vehicle.create({
            name: busName,
            display_name: device.alias,
            lpn: device.lpn || device.alias,
            imei: device.deviceName,
            fleet_name: `JURAGAN99-${device.groupName || "CARCENTRO"}`,
            vehicle_type: "Bus",
            status: "active",
          });

          console.log(
            `🆕 [CarCentro] Auto-registered vehicle: ${busName} (${device.deviceName})`
          );
        }
      } catch (err) {
        if (err.code !== 11000) {
          console.error(
            `⚠ [CarCentro] Auto-register error for ${device.alias}:`,
            err.message
          );
        }
      }
    }
  }

  /**
   * Get vehicle map (IMEI -> name) with caching
   */
  async getVehicleMap() {
    const now = Date.now();
    if (
      this.vehicleMapCache.lastUpdate &&
      now - this.vehicleMapCache.lastUpdate < 300000
    ) {
      return this.vehicleMapCache.data;
    }

    try {
      const vehicles = await Vehicle.find({ status: "active" })
        .select("imei name display_name")
        .lean();

      const map = {};
      vehicles.forEach((v) => {
        map[v.imei] = {
          name: v.name,
          display_name: v.display_name,
        };
      });

      this.vehicleMapCache = { data: map, lastUpdate: now };
      return map;
    } catch (err) {
      console.error(
        "❌ [CarCentro] Vehicle map error:",
        err.message
      );
      return this.vehicleMapCache.data || {};
    }
  }

  /**
   * Get worker status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isLoggedIn: this.service.isLoggedIn,
      fetchCount: this.fetchCount,
      errorCount: this.errorCount,
      lastFetchTime: this.lastFetchTime,
      loggedDevices: this.loggedDevices.size,
    };
  }
}

module.exports = CarCentroWorker;
