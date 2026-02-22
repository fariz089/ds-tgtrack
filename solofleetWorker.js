// solofleetWorker.js
// Integration worker for SoloFleet (solofleet.com) fleet management system
// Fetches ADAS/DMS events, vehicle live data, and video history
// Maps them into the same MongoDB collections as TGTrack data

const axios = require("axios");
const tough = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");

class SoloFleetWorker {
  constructor(config, models) {
    this.config = config;
    this.ADAS = models.ADAS;
    this.DSM = models.DSM;
    this.Vehicle = models.Vehicle;
    this.Coordinate = models.Coordinate;

    // Cookie jar for session management
    this.cookieJar = new tough.CookieJar();
    this.client = wrapper(
      axios.create({
        baseURL: this.config.baseUrl,
        timeout: 120000,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        jar: this.cookieJar,
        withCredentials: true,
        maxRedirects: 5,
      })
    );

    this.isLoggedIn = false;
    this.loginTime = null;
    this.intervalId = null;
    this.historyFetched = false;

    // Mapping SoloFleet violation types to TGTrack platform_alarm_id
    this.violationMap = {
      // DMS types
      Fatigue: {
        platform_alarm_id: 25857,
        alarm_type: "Alarm mengemudi dalam keadaan lelah",
        category: "DSM",
      },
      Telephone: {
        platform_alarm_id: 25858,
        alarm_type: "Menggunakan telepon",
        category: "DSM",
      },
      Merokok: {
        platform_alarm_id: 25859,
        alarm_type: "Alarm merokok",
        category: "DSM",
      },
      "Seat Belt": {
        platform_alarm_id: 25864,
        alarm_type: "Tidak memakai sabuk pengaman",
        category: "DSM",
      },
      Menguap: {
        platform_alarm_id: 25865,
        alarm_type: "Alarm menguap",
        category: "DSM",
      },
      "Tidak Fokus": {
        platform_alarm_id: 25860,
        alarm_type: "Alarm pengemudi tidak fokus",
        category: "DSM",
      },

      // ADAS types
      "Peringatan Pindah Jalur": {
        platform_alarm_id: 25602,
        alarm_type: "Peringatan keluar jalur (LDW)",
        category: "ADAS",
      },
      "Mobil Terlalu Dekat": {
        platform_alarm_id: 25603,
        alarm_type: "Alarm kendaraan terlalu dekat",
        category: "ADAS",
      },
      "Object depan": {
        platform_alarm_id: 25601,
        alarm_type: "Peringatan tabrakan depan (FCW)",
        category: "ADAS",
      },
      "Peringatan Tabrakan": {
        platform_alarm_id: 25601,
        alarm_type: "Peringatan tabrakan depan (FCW)",
        category: "ADAS",
      },

      // FM/Alarm ID types
      "Melebihi Kecepatan": {
        platform_alarm_id: 59392,
        alarm_type: "Kelebihan kecepatan",
        category: "FM",
      },
      "Peringatan Kecepatan": {
        platform_alarm_id: 59392,
        alarm_type: "Kelebihan kecepatan",
        category: "FM",
      },
    };
  }

  // ============================================================
  // LOGIN
  // ============================================================

  async login() {
    try {
      console.log("[SoloFleet] 🔐 Logging in...");

      // Step 1: Get login page & CSRF token
      const loginPage = await this.client.get("/Account/Login");
      const html = loginPage.data;

      const tokenMatch = html.match(
        /__RequestVerificationToken.*?value="([^"]*?)"/
      );
      if (!tokenMatch) throw new Error("CSRF token not found");

      const csrfToken = tokenMatch[1];

      // Step 2: POST login
      const formData = new URLSearchParams();
      formData.append("__RequestVerificationToken", csrfToken);
      formData.append("Email", this.config.email);
      formData.append("Password", this.config.password);
      formData.append("RememberMe", "false");

      const loginResponse = await this.client.post(
        "/Account/Login",
        formData.toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          maxRedirects: 5,
          validateStatus: (status) => status < 400,
        }
      );

      // Check if login succeeded (should redirect to /Vehicle)
      const finalUrl =
        loginResponse.request?.res?.responseUrl || loginResponse.config?.url;
      if (
        finalUrl?.includes("/Vehicle") ||
        loginResponse.status === 200 ||
        loginResponse.status === 302
      ) {
        this.isLoggedIn = true;
        this.loginTime = Date.now();
        console.log("[SoloFleet] ✅ Login berhasil!");
        return true;
      }

      throw new Error("Login redirect unexpected: " + finalUrl);
    } catch (err) {
      console.error("[SoloFleet] ❌ Login gagal:", err.message);
      this.isLoggedIn = false;
      return false;
    }
  }

  async ensureLoggedIn() {
    // Re-login every 4 hours (ASP.NET session timeout safety)
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    if (
      !this.isLoggedIn ||
      !this.loginTime ||
      Date.now() - this.loginTime >= FOUR_HOURS
    ) {
      return await this.login();
    }
    return true;
  }

  // ============================================================
  // DATA FETCHING
  // ============================================================

  async fetchVehicleLive() {
    try {
      await this.ensureLoggedIn();
      const resp = await this.client.post(
        "/Vehicle/vehiclelivewithoutzonetripNewModelCondense",
        {},
        { headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
      const data = resp.data;
      return data.vehicles || [];
    } catch (err) {
      console.error("[SoloFleet] Error fetch vehicle live:", err.message);
      if (err.response?.status === 401 || err.response?.status === 302) {
        this.isLoggedIn = false;
      }
      return [];
    }
  }

  async fetchAdasDmsEvents(startDatetime, endDatetime) {
    try {
      await this.ensureLoggedIn();
      const resp = await this.client.post(
        "/Video/getadasdms_videohistoryPerCompany",
        { startdatetime: startDatetime, enddatetime: endDatetime },
        { headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
      return resp.data || [];
    } catch (err) {
      console.error("[SoloFleet] Error fetch ADAS/DMS events:", err.message);
      if (err.response?.status === 401 || err.response?.status === 302) {
        this.isLoggedIn = false;
      }
      return [];
    }
  }

  async fetchWeeklyBreakdown(week, year, series = "dms") {
    try {
      await this.ensureLoggedIn();
      const resp = await this.client.post(
        "/Video/getAdasDMSeventperweekBreakdown",
        { week, year, series },
        { headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
      return resp.data?.output || [];
    } catch (err) {
      console.error("[SoloFleet] Error fetch weekly breakdown:", err.message);
      return [];
    }
  }

  async fetchWeeklyGroup(ndays = 30) {
    try {
      await this.ensureLoggedIn();
      const resp = await this.client.post(
        "/Video/getadasdms_videohistoryPerCompanyWeeklyGroup",
        { ndays },
        { headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
      return resp.data || [];
    } catch (err) {
      console.error("[SoloFleet] Error fetch weekly group:", err.message);
      return [];
    }
  }

  async fetchDmsDashboard(startDatetime, endDatetime) {
    try {
      await this.ensureLoggedIn();
      const resp = await this.client.post(
        "/Video/getDashboardPerVehicle",
        {
          startdatetime: startDatetime,
          enddatetime: endDatetime,
          companyid: String(this.config.companyId),
        },
        { headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
      return resp.data || [];
    } catch (err) {
      console.error("[SoloFleet] Error fetch DMS dashboard:", err.message);
      return [];
    }
  }

  async fetchVideoHistory(vehicleId, startDatetime, endDatetime) {
    try {
      await this.ensureLoggedIn();
      const resp = await this.client.post(
        "/Video/getadasdms_videohistory",
        {
          ddl: vehicleId,
          startdatetime: startDatetime,
          enddatetime: endDatetime,
        },
        { headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
      return resp.data || [];
    } catch (err) {
      console.error("[SoloFleet] Error fetch video history:", err.message);
      return [];
    }
  }

  async fetchVehicleDetail(vehicleId, startDatetime, endDatetime) {
    try {
      await this.ensureLoggedIn();
      const resp = await this.client.post(
        "/ReportDailyDetail/getVehicleDetailJsonWithoutZoneCalcFilterevery1minCalc",
        {
          ddl: vehicleId,
          startdatetime: startDatetime,
          enddatetime: endDatetime,
          interval: "1",
        },
        { headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
      return resp.data || {};
    } catch (err) {
      console.error("[SoloFleet] Error fetch vehicle detail:", err.message);
      return {};
    }
  }

  async fetchAdasEventsPerVehicle(
    vehicleId,
    startDatetime,
    endDatetime,
    companyId
  ) {
    try {
      await this.ensureLoggedIn();
      const resp = await this.client.post(
        "/ReportDailyDetail/getAdasEvents",
        {
          ddl: vehicleId,
          startdatetime: startDatetime,
          enddatetime: endDatetime,
          withzone: "withzone",
          interval: "1",
          companyid: String(companyId || this.config.companyId),
          adasdmseventscomma: "adas,dms,alarmid,threeharsh,photo",
        },
        { headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
      return resp.data || [];
    } catch (err) {
      console.error(
        "[SoloFleet] Error fetch ADAS events per vehicle:",
        err.message
      );
      return [];
    }
  }

  // ============================================================
  // DATA MAPPING & STORAGE
  // ============================================================

  mapViolationToAlarm(event) {
    const violationType = event.violationtypestring || "";
    const mapping = this.violationMap[violationType] || {
      platform_alarm_id: 0,
      alarm_type: violationType || "Unknown SoloFleet Event",
      category: "UNKNOWN",
    };
    return mapping;
  }

  generateAlarmKey(event) {
    // Create a unique key: sf_{messageid}
    return `sf_${event.messageid}`;
  }

  buildMediaFiles(event) {
    const files = [];
    if (event.medianame1url) {
      files.push({
        file_name: event.medianame1url.split("/").pop() || "front.jpg",
        file_type: 0,
        file_size: 0,
        relative_path: event.medianame1url,
      });
    }
    if (event.medianame2url) {
      files.push({
        file_name: event.medianame2url.split("/").pop() || "cabin.jpg",
        file_type: 0,
        file_size: 0,
        relative_path: event.medianame2url,
      });
    }
    if (event.medianame3url) {
      files.push({
        file_name: event.medianame3url.split("/").pop() || "extra.jpg",
        file_type: 0,
        file_size: 0,
        relative_path: event.medianame3url,
      });
    }
    return files;
  }

  async storeAlarmEvents(events) {
    let stored = 0;
    let skipped = 0;
    let errors = 0;

    for (const event of events) {
      try {
        const mapping = this.mapViolationToAlarm(event);
        const alarmKey = this.generateAlarmKey(event);
        const category = mapping.category;

        // Choose correct model
        const Model =
          category === "ADAS" || category === "FM" ? this.ADAS : this.DSM;

        // Check if already exists
        const existing = await Model.findOne({ alarm_key: alarmKey });
        if (existing) {
          skipped++;
          continue;
        }

        const doc = {
          imei: event.deviceid || this.config.defaultImei || "solofleet",
          vehicle_name: event.alias || event.vehicleid,
          lpn: event.alias || event.vehicleid,
          alarm_type: mapping.alarm_type,
          speed: event.speed || 0,
          event_time: new Date(event.gpstime || event.datetime),
          lat: event.latitude || 0,
          lng: event.longtitude || 0,
          alarm_key: alarmKey,
          platform_alarm_id: mapping.platform_alarm_id,
          files: this.buildMediaFiles(event),
          validation_status: event.eventverify ? "correct" : "pending",
          validated_by: event.eventverifyoperator_name || null,
          validated_at: event.eventverifyeditdt
            ? new Date(event.eventverifyeditdt)
            : null,
          // Extra SoloFleet-specific metadata stored in alarm_type description
          _solofleet: {
            source: "solofleet",
            messageid: event.messageid,
            safetysource: event.safetysource,
            violationtype: event.violationtype,
            violationtypestring: event.violationtypestring,
            safetyalertlevel: event.safetyalertlevel,
            streetname: event.streetname,
            city: event.city,
            subdistrict: event.subdistrict,
            districtname: event.districtname,
            fatiguelevel: event.fatiguelevel,
            currentdriver: event.currentdriver,
          },
        };

        await Model.create(doc);
        stored++;
      } catch (err) {
        if (err.code === 11000) {
          skipped++; // duplicate
        } else {
          errors++;
          if (errors <= 3)
            console.error(
              "[SoloFleet] Store error:",
              err.message?.substring(0, 100)
            );
        }
      }
    }

    return { stored, skipped, errors };
  }

  async storeVehicleData(vehicles) {
    let stored = 0;

    for (const v of vehicles) {
      try {
        await this.Vehicle.findOneAndUpdate(
          { imei: v.deviceid || `sf_${v.vehicleid}` },
          {
            name: v.alias || v.vehicleid,
            display_name: v.alias,
            lpn: v.vehicleid,
            imei: v.deviceid || `sf_${v.vehicleid}`,
            fleet_name: "SoloFleet",
            vehicle_type: v.contracttype || "unknown",
            status: "active",
            driver1: v.dv_nm || "",
            driver2: v.dv_nb || "",
          },
          { upsert: true, new: true }
        );
        stored++;
      } catch (err) {
        console.error("[SoloFleet] Vehicle store error:", err.message);
      }
    }

    return stored;
  }

  async storeCoordinates(vehicles) {
    let stored = 0;

    for (const v of vehicles) {
      if (!v.y || !v.x) continue;

      try {
        const eventTime = new Date(v.lastupdated);
        const imei = v.deviceid || `sf_${v.vehicleid}`;

        // Avoid storing duplicate coordinates
        const existing = await this.Coordinate.findOne({
          imei,
          event_time: eventTime,
        });
        if (existing) continue;

        await this.Coordinate.create({
          imei,
          device_key: v.vehicleid,
          vehicle_name: v.alias || v.vehicleid,
          event_time: eventTime,
          receive_time: new Date(),
          time_zone: `+0${v.tz || 7}:00`,
          lat: v.y,
          lng: v.x,
          speed: v.spd || 0,
          azimuth: v.course || 0,
          mileage: v.todaykm || 0,
          additional: {
            gsm_signal: v.satq || 0,
            satellites: v.satq || 0,
          },
          properties: {
            interval: 15,
            daily_subtotal: {
              date: eventTime.toISOString().split("T")[0],
              mileage: v.todaykm || 0,
            },
          },
        });
        stored++;
      } catch (err) {
        if (err.code !== 11000) {
          console.error("[SoloFleet] Coordinate store error:", err.message);
        }
      }
    }

    return stored;
  }

  // ============================================================
  // MAIN WORKER LOOP
  // ============================================================

  async fetchAndStoreAlarms(startDatetime, endDatetime) {
    console.log(
      `[SoloFleet] 📡 Fetching events ${startDatetime} -> ${endDatetime}`
    );

    const events = await this.fetchAdasDmsEvents(startDatetime, endDatetime);
    if (!events.length) {
      console.log("[SoloFleet] Tidak ada events baru");
      return { stored: 0, skipped: 0, errors: 0 };
    }

    console.log(`[SoloFleet] 📦 ${events.length} events diterima, storing...`);
    const result = await this.storeAlarmEvents(events);
    console.log(
      `[SoloFleet] ✅ Stored: ${result.stored}, Skipped: ${result.skipped}, Errors: ${result.errors}`
    );

    return result;
  }

  async fetchAndStoreHistory(days = 60) {
    if (this.historyFetched) return;

    console.log(
      `\n[SoloFleet] 🕒 MODE HISTORY: ${days} hari ke belakang...`
    );

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);

    const startStr = this.formatDatetime(startTime);
    const endStr = this.formatDatetime(endTime);

    const result = await this.fetchAndStoreAlarms(startStr, endStr);

    this.historyFetched = true;
    console.log(`[SoloFleet] ✅ HISTORY MODE COMPLETED!\n`);

    return result;
  }

  async runCycle() {
    try {
      const loggedIn = await this.ensureLoggedIn();
      if (!loggedIn) {
        console.error("[SoloFleet] ⚠ Tidak bisa login, skip cycle");
        return;
      }

      // Fetch vehicle live data and store coordinates
      const vehicles = await this.fetchVehicleLive();
      if (vehicles.length > 0) {
        const vehicleCount = await this.storeVehicleData(vehicles);
        const coordCount = await this.storeCoordinates(vehicles);
        console.log(
          `[SoloFleet] 🚗 ${vehicles.length} vehicles, ${coordCount} coordinates stored`
        );
      }

      // Fetch alarms: last 2 minutes
      const now = new Date();
      const twoMinAgo = new Date(now.getTime() - 2 * 60 * 1000);
      const startStr = this.formatDatetime(twoMinAgo);
      const endStr = this.formatDatetime(now);

      await this.fetchAndStoreAlarms(startStr, endStr);
    } catch (err) {
      console.error("[SoloFleet] ❌ Cycle error:", err.message);
      if (
        err.message.includes("401") ||
        err.message.includes("login") ||
        err.message.includes("redirect")
      ) {
        this.isLoggedIn = false;
      }
    }
  }

  start(intervalMs = 15000, fetchHistory = false, historyDays = 60) {
    console.log(
      `\n[SoloFleet] 🚀 Starting worker (interval: ${intervalMs / 1000}s)`
    );
    console.log(`[SoloFleet] 🌐 Target: ${this.config.baseUrl}`);
    console.log(`[SoloFleet] 📧 User: ${this.config.email}\n`);

    // Initial run
    (async () => {
      const loggedIn = await this.login();
      if (!loggedIn) {
        console.error("[SoloFleet] ❌ Initial login failed! Will retry...");
      }

      // Fetch history if enabled
      if (fetchHistory) {
        await this.fetchAndStoreHistory(historyDays);
      }

      // Start real-time polling
      await this.runCycle();
    })();

    this.intervalId = setInterval(() => this.runCycle(), intervalMs);
    return this;
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[SoloFleet] ⏹ Worker stopped");
    }
  }

  // ============================================================
  // HELPERS
  // ============================================================

  formatDatetime(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day} ${h}:${min}`;
  }

  getStats() {
    return {
      isLoggedIn: this.isLoggedIn,
      loginTime: this.loginTime ? new Date(this.loginTime).toISOString() : null,
      historyFetched: this.historyFetched,
      baseUrl: this.config.baseUrl,
    };
  }
}

module.exports = SoloFleetWorker;
