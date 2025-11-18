const Coordinate = require("./models/coordinate");
const Vehicle = require("./models/vehicle");

class CoordinateWorker {
  constructor(axios, token, organizeId) {
    this.axios = axios;
    this.token = token;
    this.organizeId = organizeId;
    this.lastReceiveTime = Date.now();
    this.isRunning = false;
    this.intervalId = null;
    this.vehicleMapCache = {}; // Cache untuk performa
  }

  async fetchCoordinates() {
    try {
      const requestData = {
        min_receive_time: this.lastReceiveTime,
      };

      const headers = {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en",
        Authorization: `Bearer ${this.token}`,
        Connection: "keep-alive",
        "Content-Type": "application/json;charset=UTF-8",
        DNT: "1",
        OrganizeId: this.organizeId,
        Origin: "https://ds.tgtrack.com",
        Referer: "https://ds.tgtrack.com/",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        TimeZone: "+07:00",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "X-Api-Version": "1.0.4",
      };

      const response = await this.axios.post("https://ds.tgtrack.com/api/jtt808/coordinate", requestData, { headers });

      if (response.data.code === 0 && response.data.result) {
        const coordinates = response.data.result;

        if (coordinates.length > 0) {
          await this.saveCoordinates(coordinates);

          const maxReceiveTime = Math.max(...coordinates.map((c) => c.receive_time));
          this.lastReceiveTime = maxReceiveTime;

          console.log(`✓ Fetched ${coordinates.length} coordinate updates`);
        }
      }
    } catch (err) {
      console.error("Error fetching coordinates:", err.message);
    }
  }

  async getVehicleMap() {
    // Rebuild cache setiap 5 menit
    const now = Date.now();
    if (this.vehicleMapCache.lastUpdate && now - this.vehicleMapCache.lastUpdate < 300000) {
      return this.vehicleMapCache.data;
    }

    try {
      const vehicles = await Vehicle.find({ status: "active" }).select("imei name display_name").lean();

      const map = {};
      vehicles.forEach((v) => {
        map[v.imei] = {
          name: v.name,
          display_name: v.display_name,
        };
      });

      this.vehicleMapCache = {
        data: map,
        lastUpdate: now,
      };

      return map;
    } catch (err) {
      console.error("Error building vehicle map:", err.message);
      return this.vehicleMapCache.data || {};
    }
  }

  async saveCoordinates(coordinates) {
    const vehicleMap = await this.getVehicleMap();

    for (const coord of coordinates) {
      try {
        // Map IMEI ke vehicle name
        const vehicleInfo = vehicleMap[coord.imei];
        const vehicleName = vehicleInfo?.display_name || vehicleInfo?.name || coord.imei;

        const coordData = {
          imei: coord.imei,
          device_key: coord.device_key,
          vehicle_name: vehicleName, // Nama yang proper dari Vehicle model
          event_time: new Date(coord.event_time),
          receive_time: new Date(coord.receive_time),
          time_zone: coord.time_zone,
          local_date: coord.local_date,
          state: coord.state,
          warning: coord.warning,
          lat: coord.lat,
          lng: coord.lng,
          speed: coord.speed,
          azimuth: coord.azimuth,
          height: coord.height,
          mileage: coord.mileage,
          additional: {
            gsm_signal: coord.additional?.gsm_signal,
            satellites: coord.additional?.satellites,
            vehicle_signal_bit: coord.additional?.vehicle_signal_bit,
            io: coord.additional?.io,
            alarm1078: coord.additional?.alarm1078,
            fence_list: coord.additional?.fence_list || [],
            alarm_list: coord.additional?.alarm_list || [],
          },
          properties: {
            interval: coord.properties?.interval,
            move_time: coord.properties?.move_time ? new Date(coord.properties.move_time) : null,
            acc_on_time: coord.properties?.acc_on_time ? new Date(coord.properties.acc_on_time) : null,
            daily_subtotal: coord.properties?.daily_subtotal,
          },
        };

        // Upsert untuk avoid duplicates
        await Coordinate.findOneAndUpdate(
          {
            imei: coord.imei,
            event_time: coordData.event_time,
          },
          coordData,
          { upsert: true, new: true }
        );
      } catch (err) {
        if (err.code !== 11000) {
          // Ignore duplicate key error
          console.error(`Error saving coordinate for ${coord.imei}:`, err.message);
        }
      }
    }
  }

  start(intervalMs = 10000) {
    if (this.isRunning) {
      console.log("⚠ Coordinate worker already running");
      return;
    }

    console.log("🌍 Starting Coordinate Worker...");
    this.isRunning = true;

    // Fetch immediately
    this.fetchCoordinates();

    // Then fetch every interval
    this.intervalId = setInterval(() => {
      this.fetchCoordinates();
    }, intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log("🛑 Coordinate Worker stopped");
  }

  updateAuth(token, organizeId) {
    this.token = token;
    this.organizeId = organizeId;
  }
}

module.exports = CoordinateWorker;
