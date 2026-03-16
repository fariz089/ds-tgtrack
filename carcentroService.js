// carcentroService.js
// Service for interacting with CarCentro (AoooG) GPS Tracking API
// Platform: carcentro.aooog.com
// Company: JURAGAN 99 TRANS

const axios = require("axios");

class CarCentroService {
  constructor(config) {
    this.baseUrl = config.baseUrl || "http://carcentro.aooog.com";
    this.username = config.username;
    this.password = config.password;
    this.authToken = null; // Base64 encoded auth
    this.sessionKey = null; // Encrypted session key from login
    this.isLoggedIn = false;
    this.lastLoginTime = null;
    this.deviceGroupCache = null;
    this.deviceGroupCacheTime = null;
    this.CACHE_TTL = 5 * 60 * 1000; // 5 min cache

    // Build base64 authentication token
    this.authToken = Buffer.from(
      JSON.stringify({ name: this.username, pwd: this.password })
    ).toString("base64");
  }

  /**
   * Login to CarCentro and get session key
   */
  async login() {
    try {
      console.log("🔑 [CarCentro] Logging in...");

      const now = new Date();
      const localTime = now.toLocaleString("en-US", {
        timeZone: "Asia/Jakarta",
      });

      const params = new URLSearchParams({
        authentication: this.authToken,
        localTime: localTime,
        "domain[]": new URL(this.baseUrl).hostname,
        _: Date.now().toString(),
      });

      const response = await axios.get(
        `${this.baseUrl}/AoooG_WebService.svc/Login?${params.toString()}`,
        {
          headers: {
            Accept: "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          timeout: 15000,
        }
      );

      // After login, get the session key via AjaxSettingParameter
      const settingResp = await this.callAjaxSetting(
        "GetAccountOptions",
        ""
      );

      if (settingResp) {
        this.isLoggedIn = true;
        this.lastLoginTime = Date.now();
        console.log("✅ [CarCentro] Login successful");
        return true;
      }

      return false;
    } catch (err) {
      console.error("❌ [CarCentro] Login failed:", err.message);
      this.isLoggedIn = false;
      return false;
    }
  }

  /**
   * Get encrypted session key via ClientToWebService
   */
  async getSessionKey() {
    try {
      const response = await axios.post(
        `${this.baseUrl}/AoooG_WebService.svc/ClientToWebService`,
        {
          key: this.sessionKey,
          proName: "GetDeviceGroup",
          json: "",
        },
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 15000,
        }
      );

      return response.data?.d;
    } catch (err) {
      console.error(
        "❌ [CarCentro] Failed to get session key:",
        err.message
      );
      return null;
    }
  }

  /**
   * Call AjaxSettingParameter endpoint
   */
  async callAjaxSetting(proName, json, isCompress = 0) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/AoooG_WebService.svc/AjaxSettingParameter`,
        {
          authentication: this.authToken,
          proName: proName,
          isCompress: isCompress,
          json: json,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 30000,
        }
      );

      return response.data?.d;
    } catch (err) {
      console.error(
        `❌ [CarCentro] AjaxSetting ${proName} failed:`,
        err.message
      );
      return null;
    }
  }

  /**
   * Call AjaxMaintenance endpoint
   */
  async callAjaxMaintenance(proName, json, isCompress = 0) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/AoooG_WebService.svc/AjaxMaintenance`,
        {
          authentication: this.authToken,
          proName: proName,
          isCompress: isCompress,
          json: json,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 30000,
        }
      );

      return response.data?.d;
    } catch (err) {
      console.error(
        `❌ [CarCentro] AjaxMaintenance ${proName} failed:`,
        err.message
      );
      return null;
    }
  }

  /**
   * Fetch real-time tracking data for ALL devices
   * This is the main data endpoint - returns lat, lng, speed, acc, odometer, etc.
   */
  async fetchTrackData() {
    try {
      const response = await this.callAjaxMaintenance(
        "TrackData",
        JSON.stringify({
          offset: 0,
          fetchNext: 6000,
          timeZoneMinute: 420, // UTC+7 (WIB)
        }),
        2 // isCompress = 2
      );

      if (!response || !response.JsonFileName) {
        console.warn("⚠ [CarCentro] No track data received");
        return [];
      }

      try {
        const devices = JSON.parse(response.JsonFileName);
        return Array.isArray(devices) ? devices : [];
      } catch (parseErr) {
        console.error(
          "❌ [CarCentro] Failed to parse track data:",
          parseErr.message
        );
        return [];
      }
    } catch (err) {
      console.error("❌ [CarCentro] fetchTrackData failed:", err.message);
      return [];
    }
  }

  /**
   * Fetch device groups (AKAP, PARIWISATA, OPERASIONAL)
   */
  async fetchDeviceGroups() {
    try {
      // Check cache
      if (
        this.deviceGroupCache &&
        this.deviceGroupCacheTime &&
        Date.now() - this.deviceGroupCacheTime < this.CACHE_TTL
      ) {
        return this.deviceGroupCache;
      }

      const response = await this.callAjaxSetting(
        "GetDeviceGroupData",
        ""
      );

      if (!response || !response.JsonFileName) {
        return [];
      }

      try {
        const groups = JSON.parse(response.JsonFileName);
        this.deviceGroupCache = Array.isArray(groups) ? groups : [];
        this.deviceGroupCacheTime = Date.now();
        return this.deviceGroupCache;
      } catch (parseErr) {
        console.error(
          "❌ [CarCentro] Failed to parse device groups:",
          parseErr.message
        );
        return [];
      }
    } catch (err) {
      console.error(
        "❌ [CarCentro] fetchDeviceGroups failed:",
        err.message
      );
      return [];
    }
  }

  /**
   * Fetch video channel configuration for a device
   */
  async fetchVideoConfig(deviceID) {
    try {
      const response = await this.callAjaxSetting(
        "GetDeviceVideoConfig",
        JSON.stringify({ DeviceID: deviceID })
      );

      if (!response || !response.JsonFileName) {
        return [];
      }

      try {
        return JSON.parse(response.JsonFileName);
      } catch {
        return [];
      }
    } catch (err) {
      console.error(
        `❌ [CarCentro] fetchVideoConfig(${deviceID}) failed:`,
        err.message
      );
      return [];
    }
  }

  /**
   * Fetch geofences
   */
  async fetchGeofences() {
    try {
      const response = await this.callAjaxMaintenance(
        "GetGeofences",
        JSON.stringify({ ID: 0 })
      );

      if (!response || !response.JsonFileName) {
        return [];
      }

      try {
        return JSON.parse(response.JsonFileName);
      } catch {
        return [];
      }
    } catch (err) {
      console.error(
        "❌ [CarCentro] fetchGeofences failed:",
        err.message
      );
      return [];
    }
  }

  /**
   * Ensure we are logged in, re-login if session expired
   */
  async ensureLoggedIn() {
    const SESSION_TTL = 4 * 60 * 60 * 1000; // Re-login every 4 hours

    if (
      !this.isLoggedIn ||
      !this.lastLoginTime ||
      Date.now() - this.lastLoginTime > SESSION_TTL
    ) {
      return await this.login();
    }

    return true;
  }

  /**
   * Parse a CarCentro device record into a standardized format
   */
  static parseDeviceRecord(device) {
    // Extract bus name from Alias (e.g., "N 7709 GG-PEGASUS" -> name: "PEGASUS", lpn: "N 7709 GG")
    const alias = device.Alias || "";
    let busName = "";
    let lpn = "";

    const dashIndex = alias.lastIndexOf("-");
    if (dashIndex !== -1) {
      lpn = alias.substring(0, dashIndex).trim();
      busName = alias.substring(dashIndex + 1).trim();
    } else {
      busName = alias.trim();
      lpn = alias.trim();
    }

    // Determine vehicle status from statusIcon and acc
    // statusIcon: 0 = offline, 2 = parked/standby, 3 = ACC ON/idle, 6 = moving
    let status = "unknown";
    if (device.statusIcon === 0) status = "offline";
    else if (device.statusIcon === 2) status = "parked";
    else if (device.statusIcon === 3) status = "idle";
    else if (device.statusIcon === 6) status = "moving";

    return {
      // Identity
      deviceID: device.deviceID,
      deviceName: device.deviceName, // IMEI-like identifier
      alias: alias,
      busName: busName,
      lpn: lpn,

      // GPS Data
      latitude: device.Latitude,
      longitude: device.Longitude,
      heading: device.Heading,
      speed: device.speed || 0,
      gpsDateTime: device.gpsDateTime,
      gpsAccuracy: device.GpsAccuracy,

      // Vehicle Status
      acc: device.acc, // "ON" or "OFF"
      statusIcon: device.statusIcon,
      status: status,
      gpsSignal: device.GPSSignal,

      // Odometer
      odometer: device.odometer || 0,
      todayOdometer: device.todayOdometer || 0,

      // Location
      location: device.location || "",
      hotSpot: device.hotSpot || "",

      // Parking
      parkingDateTime: device.parkingDateTime,
      parkingDuration: device.parkingDuration || "",

      // Idle
      idleTime: device.idleTime || "",

      // Group
      groupName: device.groupName || "",

      // Company
      companyName: device.companyName || "JURAGAN 99 TRANS",
      companyId: device.companyId,

      // Device Info
      modelBrand: device.modelBrand || "",
      simNumber: device.simNumber || "",

      // Video
      hasDVR: !!(
        device.ReportHeaderTag && device.ReportHeaderTag.includes("DVR")
      ),
      serverInfo: device.serverInfo || "",

      // Fuel
      fuel1: device.fuel1 || 0,
      fuel2: device.fuel2 || 0,
      fuelTotal: device.fuel_total || 0,

      // Speeding threshold
      speedingLimit: device.Speeding || 120,

      // Source identifier
      source: "carcentro",
    };
  }
}

module.exports = CarCentroService;
