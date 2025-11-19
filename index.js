// index.js
const puppeteer = require("puppeteer");
const axios = require("axios");
const path = require("path");
const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const config = require("./config");
const LoginManager = require("./login");
const AlarmFileQueue = require("./queue");
const WhatsAppService = require("./whatsapp");
const { sleep, isLoggedIn, interceptAuthData } = require("./utils");
const mongoose = require("mongoose");

const app = express();

const Alert = require("./models/alert");
const ADAS = require("./models/adas");
const DSM = require("./models/dsm");
const Vehicle = require("./models/vehicle");
const Coordinate = require("./models/coordinate");
const SafetyScoreService = require("./safetyScoreService");
const CoordinateWorker = require("./coordinateWorker");
const AlarmStoreWorker = require("./alarmStoreWorker");

// Setup EJS dengan layout
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const safetyScoreService = new SafetyScoreService();

// Helper to get vehicles from database with fallback
async function getVehiclesList() {
  try {
    const vehicles = await Vehicle.find({ status: "active" })
      .select("name")
      .lean();

    if (vehicles.length > 0) {
      return vehicles.map((v) => v.name).sort();
    }

    // Fallback: ambil dari ADAS/DSM menggunakan vehicle_name
    const adasVehicles = await ADAS.distinct("vehicle_name");
    const dsmVehicles = await DSM.distinct("vehicle_name");
    const allVehicles = [...new Set([...adasVehicles, ...dsmVehicles])];

    return allVehicles.length > 0 ? allVehicles.sort() : [];
  } catch (err) {
    console.error("Error fetching vehicles:", err);
    return [];
  }
}

// Dashboard page
app.get("/", async (req, res) => {
  try {
    const vehicles = await getVehiclesList();

    res.render("dashboard", {
      title: "Fleet Dashboard",
      vehicles: vehicles,
      currentPage: "dashboard",
      googleMapsApiKey: config.googleMaps.apiKey,
    });
  } catch (err) {
    console.error("Error rendering dashboard:", err);
    res.render("dashboard", {
      title: "Fleet Dashboard",
      vehicles: [],
      currentPage: "dashboard",
      googleMapsApiKey: config.googleMaps.apiKey,
    });
  }
});

// ADAS monitoring page
app.get("/adas", async (req, res) => {
  try {
    const vehicles = await getVehiclesList();

    res.render("adas", {
      title: "ADAS Monitoring",
      vehicles: vehicles,
      currentPage: "adas",
    });
  } catch (err) {
    console.error("Error rendering ADAS page:", err);
    res.render("adas", {
      title: "ADAS Monitoring",
      vehicles: [],
      currentPage: "adas",
    });
  }
});

// DSM monitoring page
app.get("/dsm", async (req, res) => {
  try {
    const vehicles = await getVehiclesList();

    res.render("dsm", {
      title: "DSM Monitoring",
      vehicles: vehicles,
      currentPage: "dsm",
    });
  } catch (err) {
    console.error("Error rendering DSM page:", err);
    res.render("dsm", {
      title: "DSM Monitoring",
      vehicles: [],
      currentPage: "dsm",
    });
  }
});

// API: Get recent alerts
app.get("/api/alerts", async (req, res) => {
  try {
    const { limit = 100, vehicle } = req.query;
    let query = {};

    if (vehicle && vehicle !== "all") {
      query.vehicle = vehicle;
    }

    const alerts = await Alert.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    res.json(alerts);
  } catch (err) {
    console.error("Error fetching alerts:", err);
    res.status(500).json({ message: "Failed to fetch alerts" });
  }
});

// API: Get ADAS data with optional filters
app.get("/api/adas", async (req, res) => {
  try {
    const { startDate, endDate, vehicle, limit = 100 } = req.query;
    let query = {};

    // Filter by vehicle name if specified
    if (vehicle && vehicle !== "all") {
      query.vehicle_name = new RegExp(vehicle, "i");
    }

    // Filter by date range if provided
    if (startDate && endDate) {
      query.event_time = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const adasData = await ADAS.find(query)
      .sort({ event_time: -1 })
      .limit(parseInt(limit));

    res.json(adasData);
  } catch (err) {
    console.error("Error fetching ADAS data:", err);
    res.status(500).json({ message: "Failed to fetch ADAS data" });
  }
});

// API: Get DSM data with optional filters
app.get("/api/dsm", async (req, res) => {
  try {
    const { startDate, endDate, vehicle, limit = 100 } = req.query;
    let query = {};

    // Filter by vehicle name if specified
    if (vehicle && vehicle !== "all") {
      query.vehicle_name = new RegExp(vehicle, "i");
    }

    // Filter by date range if provided
    if (startDate && endDate) {
      query.event_time = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const dsmData = await DSM.find(query)
      .sort({ event_time: -1 })
      .limit(parseInt(limit));

    res.json(dsmData);
  } catch (err) {
    console.error("Error fetching DSM data:", err);
    res.status(500).json({ message: "Failed to fetch DSM data" });
  }
});

// API: Get aggregated fleet statistics
app.get("/api/fleet-stats", async (req, res) => {
  try {
    const { startDate, endDate, vehicle } = req.query;
    let matchStage = {};

    // Build query filter for vehicle and date range
    if (vehicle && vehicle !== "all") {
      matchStage.vehicle_name = new RegExp(vehicle, "i");
    }

    if (startDate && endDate) {
      matchStage.event_time = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const adasCount = await ADAS.countDocuments(matchStage);
    const dsmCount = await DSM.countDocuments(matchStage);

    res.json({
      summary: {
        totalADAS: adasCount,
        totalDSM: dsmCount,
      },
    });
  } catch (err) {
    console.error("Error fetching fleet stats:", err);
    res.status(500).json({ message: "Failed to fetch fleet stats" });
  }
});

// API: Get list of all vehicles from master data
app.get("/api/vehicles", async (req, res) => {
  try {
    const vehicles = await Vehicle.find({ status: "active" })
      .select("name driver1 driver2 coDriver status")
      .sort({ name: 1 });

    res.json(vehicles);
  } catch (err) {
    console.error("Error fetching vehicles:", err);
    res.status(500).json({
      message: "Failed to fetch vehicles",
      error: err.message,
    });
  }
});

// API: Get vehicles list (names only) for dropdown
app.get("/api/vehicles/list", async (req, res) => {
  try {
    const vehicleNames = await getVehiclesList();
    res.json(vehicleNames);
  } catch (err) {
    console.error("Error fetching vehicle list:", err);
    res.status(500).json({
      message: "Failed to fetch vehicle list",
      error: err.message,
    });
  }
});

// API: Get vehicle detail by name
app.get("/api/vehicles/:name", async (req, res) => {
  try {
    const vehicle = await Vehicle.findOne({ name: req.params.name });

    if (!vehicle) {
      return res.status(404).json({ message: "Vehicle not found" });
    }

    res.json(vehicle);
  } catch (err) {
    console.error("Error fetching vehicle detail:", err);
    res.status(500).json({
      message: "Failed to fetch vehicle detail",
      error: err.message,
    });
  }
});

// API: Get latest coordinates (real-time tracking)
app.get("/api/coordinates/latest", async (req, res) => {
  try {
    const { vehicle } = req.query;
    let query = {};

    if (vehicle && vehicle !== "all") {
      query.vehicle_name = new RegExp(vehicle, "i");
    }

    // Get latest coordinate for each vehicle
    const latestCoords = await Coordinate.aggregate([
      { $match: query },
      { $sort: { event_time: -1 } },
      {
        $group: {
          _id: "$imei",
          latest: { $first: "$$ROOT" },
        },
      },
      { $replaceRoot: { newRoot: "$latest" } },
    ]);

    res.json(latestCoords);
  } catch (err) {
    console.error("Error fetching latest coordinates:", err);
    res.status(500).json({ message: "Failed to fetch coordinates" });
  }
});

// API: Get coordinate history for specific vehicle
app.get("/api/coordinates/history/:imei", async (req, res) => {
  try {
    const { imei } = req.params;
    const { startDate, endDate, limit = 100 } = req.query;

    let query = { imei: imei };

    if (startDate && endDate) {
      query.event_time = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const history = await Coordinate.find(query)
      .sort({ event_time: -1 })
      .limit(parseInt(limit));

    res.json(history);
  } catch (err) {
    console.error("Error fetching coordinate history:", err);
    res.status(500).json({ message: "Failed to fetch history" });
  }
});

// API: Get fleet map data (for real-time map visualization)
app.get("/api/fleet/map", async (req, res) => {
  try {
    const latestCoords = await Coordinate.aggregate([
      { $sort: { event_time: -1 } },
      {
        $group: {
          _id: "$imei",
          vehicle_name: { $first: "$vehicle_name" },
          lat: { $first: "$lat" },
          lng: { $first: "$lng" },
          speed: { $first: "$speed" },
          azimuth: { $first: "$azimuth" },
          event_time: { $first: "$event_time" },
          state: { $first: "$state" },
          warning: { $first: "$warning" },
          mileage: { $first: "$mileage" },
        },
      },
    ]);

    res.json(latestCoords);
  } catch (err) {
    console.error("Error fetching fleet map:", err);
    res.status(500).json({ message: "Failed to fetch fleet map" });
  }
});

// API: Get fleet safety score
app.get("/api/safety/fleet-score", async (req, res) => {
  try {
    const { hours, startDate, endDate } = req.query;

    const options = {};

    if (startDate && endDate) {
      // mode custom tanggal
      options.startDate = startDate;
      options.endDate = endDate;
    } else {
      // mode last X hours (3 jam, 5 jam, dst.)
      options.hoursBack = parseInt(hours) || 1;
    }

    const fleetScore = await safetyScoreService.calculateFleetScore(options);
    res.json(fleetScore);
  } catch (err) {
    console.error("Error calculating fleet score:", err);
    res.status(500).json({ message: "Failed to calculate fleet score" });
  }
});

// API: Get vehicle safety score
app.get("/api/safety/vehicle-score/:vehicleName", async (req, res) => {
  try {
    const { vehicleName } = req.params;
    const { hours = 1 } = req.query;
    const vehicleScore = await safetyScoreService.calculateVehicleScore(
      vehicleName,
      parseInt(hours)
    );
    res.json(vehicleScore);
  } catch (err) {
    console.error("Error calculating vehicle score:", err);
    res.status(500).json({ message: "Failed to calculate vehicle score" });
  }
});

// API: Get risky vehicles
app.get("/api/safety/risky-vehicles", async (req, res) => {
  try {
    const { hours, startDate, endDate, limit = 5 } = req.query;

    const options = { limit: parseInt(limit) || 5 };

    if (startDate && endDate) {
      options.startDate = startDate;
      options.endDate = endDate;
    } else {
      options.hoursBack = parseInt(hours) || 1;
    }

    const riskyVehicles = await safetyScoreService.getRiskyVehicles(options);
    res.json(riskyVehicles);
  } catch (err) {
    console.error("Error fetching risky vehicles:", err);
    res.status(500).json({ message: "Failed to fetch risky vehicles" });
  }
});

// API: Get alarm statistics
app.get("/api/safety/alarm-statistics", async (req, res) => {
  try {
    const { hours = 24 } = req.query;
    const stats = await safetyScoreService.getAlarmStatistics(parseInt(hours));
    res.json(stats);
  } catch (err) {
    console.error("Error fetching alarm statistics:", err);
    res.status(500).json({ message: "Failed to fetch statistics" });
  }
});

// ✅ API: Get alarms by vehicle (support startDate/endDate atau hours)
app.get("/api/alarms/by-vehicle/:vehicleName", async (req, res) => {
  try {
    const { vehicleName } = req.params;
    const { hours = 1, limit = 20, startDate, endDate } = req.query;

    let startTime;
    let endTime;

    if (startDate && endDate) {
      // mode custom tanggal (pakai yang dikirim front-end)
      startTime = new Date(startDate);
      endTime = new Date(endDate);
    } else {
      // mode last X hours
      const h = parseInt(hours) || 1;
      endTime = new Date();
      startTime = new Date(endTime.getTime() - h * 60 * 60 * 1000);
    }

    const adasAlarms = await ADAS.find({
      vehicle_name: vehicleName,
      event_time: { $gte: startTime, $lte: endTime },
    })
      .sort({ event_time: -1 })
      .limit(parseInt(limit))
      .lean();

    const dsmAlarms = await DSM.find({
      vehicle_name: vehicleName,
      event_time: { $gte: startTime, $lte: endTime },
    })
      .sort({ event_time: -1 })
      .limit(parseInt(limit))
      .lean();

    const allAlarms = [...adasAlarms, ...dsmAlarms]
      .sort((a, b) => new Date(b.event_time) - new Date(a.event_time))
      .slice(0, parseInt(limit));

    res.json({
      vehicle_name: vehicleName,
      period: startDate && endDate ? `${startDate} → ${endDate}` : `${hours} hour(s)`,
      total: allAlarms.length,
      alarms: allAlarms,
    });
  } catch (err) {
    console.error("Error fetching alarms by vehicle:", err);
    res.status(500).json({ error: err.message });
  }
});

// Connect to MongoDB
mongoose
  .connect(config.mongo, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Start Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express listening on port ${PORT}`);
});

// Wait until next 15-second interval (00, 15, 30, 45)
async function waitUntilNext15Seconds() {
  const now = new Date();
  const currentSeconds = now.getSeconds();

  let targetSeconds;
  if (currentSeconds < 15) {
    targetSeconds = 15;
  } else if (currentSeconds < 30) {
    targetSeconds = 30;
  } else if (currentSeconds < 45) {
    targetSeconds = 45;
  } else {
    targetSeconds = 60;
  }

  const nextTime = new Date(now);
  if (targetSeconds === 60) {
    nextTime.setMinutes(now.getMinutes() + 1);
    nextTime.setSeconds(0);
  } else {
    nextTime.setSeconds(targetSeconds);
  }
  nextTime.setMilliseconds(0);

  const waitMs = nextTime - now;
  const waitSec = Math.floor(waitMs / 1000);

  console.log(
    `⏰ Tunggu ${waitSec}s sampai ${nextTime.toLocaleTimeString(
      "id-ID"
    )} untuk cycle berikutnya...`
  );
  await sleep(waitMs);
}

// Format date to API-compatible format with timezone
function formatTime(date) {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}+07:00`;
}

async function main() {
  let browser;
  let page;
  let token;
  let organizeId;

  const whatsappService = null;
  let globalQueue = null;
  let coordinateWorker = null; // Deklarasi coordinate worker

  try {
    console.log("🚀 Starting DS-TGTrack Monitor Service...\n");
    console.log("launching browser dengan persistent session...");
    browser = await puppeteer.launch(config.browser);
    page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on("request", (request) => {
      request.continue();
    });

    console.log("navigasi ke halaman...");
    await page.goto(config.target.url, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    await sleep(2000);
    const alreadyLoggedIn = await isLoggedIn(page);

    if (alreadyLoggedIn) {
      console.log("✓ Sudah login dari session sebelumnya!");
    } else {
      console.log("Belum login, mulai proses login...");

      const loginManager = new LoginManager(config);
      const loginResult = await loginManager.login(page);

      if (!loginResult.success) {
        console.log("✗ Login gagal, url terakhir:", loginResult.url);
        return;
      }

      console.log("✓ Login berhasil!");
      await sleep(3000);
    }

    console.log("tunggu intercept token...");
    await sleep(2000);
    const authData = await interceptAuthData(page);
    token = authData.token;
    organizeId = authData.organizeId || "61a22a23e0584dac";

    console.log("✓ Token dan OrganizeId berhasil diambil\n");

    // Initialize workers
    globalQueue = new AlarmFileQueue(
      axios,
      token,
      organizeId,
      whatsappService,
      5,
      300000
    );
    const alarmStoreWorker = new AlarmStoreWorker(axios, token, organizeId);

    // Initialize and start coordinate worker
    coordinateWorker = new CoordinateWorker(axios, token, organizeId);
    coordinateWorker.start(10000); // Fetch coordinates every 10 seconds

    // Fetch and process alarms within time range with pagination
    async function fetchAndProcessRange(startTime, endTime, options = {}) {
      const { includeQueue = true, pageLimit = 200 } = options;

      let pageNo = 1;
      let fetchedTotal = 0;

      console.log(
        `📡 Fetching safety alarms range ${formatTime(
          startTime
        )} -> ${formatTime(endTime)}`
      );

      while (true) {
        const requestData = {
          page: pageNo,
          limit: pageLimit,
          start_time: formatTime(startTime),
          end_time: formatTime(endTime),
        };

        const headers = {
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en",
          Authorization: `Bearer ${token}`,
          Connection: "keep-alive",
          "Content-Type": "application/json;charset=UTF-8",
          DNT: "1",
          OrganizeId: organizeId,
          Origin: "https://ds.tgtrack.com",
          Referer: "https://ds.tgtrack.com/",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
          TimeZone: "+07:00",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
          "X-Api-Version": "1.0.4",
          "sec-ch-ua":
            '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
        };

        console.log(`   → Request page ${pageNo}, limit ${pageLimit}`);

        const response = await axios.post(
          "https://ds.tgtrack.com/api/jtt808/alarm/safety",
          requestData,
          { headers }
        );
        const safetyData = response.data;

        const rows = safetyData.result?.rows || [];
        const total = safetyData.result?.total || 0;

        // 🔍 DEBUG RAW ALARM DATA
        if (rows.length > 0 && rows[0]) {
          const firstAlarm = rows[0];
          console.log("\n🔍 DEBUG RAW ALARM:");
          console.log(
            "  Request range:",
            requestData.start_time,
            "->",
            requestData.end_time
          );
          console.log("  First alarm vehicle:", firstAlarm.vehicle_name);
          console.log("  event_time (raw):", firstAlarm.event_time);
          console.log("  event_time (Date):", new Date(firstAlarm.event_time));
          console.log(
            "  event_time (ISO):",
            new Date(firstAlarm.event_time).toISOString()
          );
          console.log("");
        }

        console.log(`   ✓ Page ${pageNo}: rows=${rows.length}, total=${total}`);

        if (!rows.length) {
          break;
        }

        fetchedTotal += rows.length;

        alarmStoreWorker.addAlarms(rows);

        if (includeQueue && globalQueue) {
          const added = globalQueue.addAlarms(rows);
          if (added > 0 && !globalQueue.isProcessing) {
            globalQueue.startBackgroundWorker();
          }
        }

        if (fetchedTotal >= total) {
          break;
        }

        pageNo++;
      }

      console.log(
        `📦 Selesai fetch range. Total rows diproses: ${fetchedTotal}\n`
      );
    }

    let cycleCount = 0;
    let firstCycle = true;

    while (true) {
      cycleCount++;
      const now = new Date();

      console.log("\n" + "=".repeat(60));
      console.log(
        `🔄 CYCLE #${cycleCount} - ${now.toLocaleString("id-ID", {
          timeZone: "Asia/Jakarta",
        })}`
      );
      console.log("=".repeat(60) + "\n");

      if (cycleCount > 1 && globalQueue) {
        globalQueue.printStatus();
        console.log("");
      }

      try {
        const endTime = new Date();
        let startTime;

        if (firstCycle) {
          const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
          startTime = new Date(endTime.getTime() - THREE_DAYS_MS);
          console.log("🕒 MODE HISTORY: 3 hari ke belakang");
          console.log(
            "⏳ Fetching historical data... This may take several minutes..."
          );

          await fetchAndProcessRange(startTime, endTime, {
            includeQueue: false,
            pageLimit: 200,
          });

          firstCycle = false;
          console.log(
            "✅ HISTORY MODE COMPLETED! Next cycle will be REALTIME.\n"
          );
        } else {
          startTime = new Date(endTime.getTime() - 60000);
          console.log("🕒 MODE REALTIME: 60 detik terakhir");

          await fetchAndProcessRange(startTime, endTime, {
            includeQueue: true,
            pageLimit: 50,
          });
        }
      } catch (error) {
        console.error("✗ Error dalam cycle:", error.message);

        // Re-authenticate if token expired
        if (error.message.includes("401") || error.message.includes("token")) {
          console.log("⚠ Mencoba re-intercept token...");
          const authData2 = await interceptAuthData(page);
          token = authData2.token;
          organizeId = authData2.organizeId || "61a22a23e0584dac";

          // Update token untuk semua workers
          if (globalQueue) {
            globalQueue.token = token;
            globalQueue.organizeId = organizeId;
          }

          if (coordinateWorker) {
            coordinateWorker.updateAuth(token, organizeId);
          }
        }
      }

      await waitUntilNext15Seconds();
    }
  } catch (error) {
    console.error("✗ Fatal Error:", error.message);
    console.error(error.stack);
  } finally {
    // Stop coordinate worker saat shutdown
    if (coordinateWorker) {
      coordinateWorker.stop();
    }

    if (browser) {
      await browser.close();
      console.log("browser ditutup");
    }
  }
}

setTimeout(() => {
  main();
}, 2000);
