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
const VideoStreamService = require("./videoStreamService");
const { sleep, isLoggedIn, interceptAuthData } = require("./utils");
const mongoose = require("mongoose");

const { initWebSocketServer, getWss } = require("./ws-server");

const app = express();

const Alert = require("./models/alert");
const ADAS = require("./models/adas");
const DSM = require("./models/dsm");
const Vehicle = require("./models/vehicle");
const Coordinate = require("./models/coordinate");
const HealthData = require("./models/healthData");
const SafetyScoreService = require("./safetyScoreService");
const CoordinateWorker = require("./coordinateWorker");
const AlarmStoreWorker = require("./alarmStoreWorker");
const SoloFleetWorker = require("./solofleetWorker");
const SoloFleetVideoService = require("./solofleetVideoService");

// Setup EJS dengan layout
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const safetyScoreService = new SafetyScoreService();
const videoStreamService = new VideoStreamService();

// Helper to get vehicles from database with fallback
async function getVehiclesList() {
  try {
    const vehicles = await Vehicle.find({ status: "active" }).select("name").lean();

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

// Command Center page
app.get("/command-center", async (req, res) => {
  try {
    const vehicles = await getVehiclesList();

    res.render("command-center", {
      title: "Command Center",
      vehicles: vehicles,
      currentPage: "command-center",
      googleMapsApiKey: config.googleMaps.apiKey,
    });
  } catch (err) {
    console.error("Error rendering Command Center:", err);
    res.render("command-center", {
      title: "Command Center",
      vehicles: [],
      currentPage: "command-center",
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

// Fleet Reports page
app.get("/fleet-reports", async (req, res) => {
  try {
    const vehicles = await getVehiclesList();
    res.render("fleet-reports", {
      title: "Fleet Reports",
      vehicles: vehicles,
      currentPage: "fleet-reports",
    });
  } catch (err) {
    console.error("Error rendering Fleet Reports page:", err);
    res.render("fleet-reports", {
      title: "Fleet Reports",
      vehicles: [],
      currentPage: "fleet-reports",
    });
  }
});

// Export Data page
app.get("/export-data", async (req, res) => {
  try {
    const vehicles = await getVehiclesList();
    res.render("export-data", {
      title: "Export Data",
      vehicles: vehicles,
      currentPage: "export-data",
    });
  } catch (err) {
    console.error("Error rendering Export Data page:", err);
    res.render("export-data", {
      title: "Export Data",
      vehicles: [],
      currentPage: "export-data",
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

    const alerts = await Alert.find(query).sort({ timestamp: -1 }).limit(parseInt(limit));

    res.json(alerts);
  } catch (err) {
    console.error("Error fetching alerts:", err);
    res.status(500).json({ message: "Failed to fetch alerts" });
  }
});

// API: Get ADAS data with optional filters (support hours & startDate/endDate)
app.get("/api/adas", async (req, res) => {
  try {
    const { hours, startDate, endDate, vehicle, limit = 100 } = req.query;
    let query = {};

    // Filter by vehicle name
    if (vehicle && vehicle !== "all") {
      query.vehicle_name = new RegExp(vehicle, "i");
    }

    // ✅ Filter by date range
    let startTime, endTime;

    if (startDate && endDate) {
      // Mode custom tanggal
      startTime = new Date(startDate);
      endTime = new Date(endDate);
    } else if (hours) {
      // Mode last X hours
      const h = parseInt(hours) || 1;
      endTime = new Date();
      startTime = new Date(endTime.getTime() - h * 60 * 60 * 1000);
    }

    // Apply time filter
    if (startTime && endTime) {
      query.event_time = {
        $gte: startTime,
        $lte: endTime,
      };
    }

    const adasData = await ADAS.find(query).sort({ event_time: -1 }).limit(parseInt(limit));

    res.json(adasData);
  } catch (err) {
    console.error("Error fetching ADAS data:", err);
    res.status(500).json({ message: "Failed to fetch ADAS data" });
  }
});

// API: Get DSM data with optional filters (support hours & startDate/endDate)
app.get("/api/dsm", async (req, res) => {
  try {
    const { hours, startDate, endDate, vehicle, limit = 100 } = req.query;
    let query = {};

    // Filter by vehicle name
    if (vehicle && vehicle !== "all") {
      query.vehicle_name = new RegExp(vehicle, "i");
    }

    // ✅ Filter by date range
    let startTime, endTime;

    if (startDate && endDate) {
      // Mode custom tanggal
      startTime = new Date(startDate);
      endTime = new Date(endDate);
    } else if (hours) {
      // Mode last X hours
      const h = parseInt(hours) || 1;
      endTime = new Date();
      startTime = new Date(endTime.getTime() - h * 60 * 60 * 1000);
    }

    // Apply time filter
    if (startTime && endTime) {
      query.event_time = {
        $gte: startTime,
        $lte: endTime,
      };
    }

    const dsmData = await DSM.find(query).sort({ event_time: -1 }).limit(parseInt(limit));

    res.json(dsmData);
  } catch (err) {
    console.error("Error fetching DSM data:", err);
    res.status(500).json({ message: "Failed to fetch DSM data" });
  }
});

// API: Get ADAS data for DataTables (server-side processing)
app.get("/api/adas/datatable", async (req, res) => {
  try {
    const { draw, start, length, search, order, columns, vehicle, hours, startDate, endDate } = req.query;

    // Build base query
    let query = {};

    // Filter by vehicle
    if (vehicle && vehicle !== "all") {
      query.vehicle_name = new RegExp(vehicle, "i");
    }

    // Filter by date range
    let startTime, endTime;
    if (startDate && endDate) {
      startTime = new Date(startDate);
      endTime = new Date(endDate);
    } else if (hours) {
      const h = parseInt(hours) || 24;
      endTime = new Date();
      startTime = new Date(endTime.getTime() - h * 60 * 60 * 1000);
    }

    if (startTime && endTime) {
      query.event_time = {
        $gte: startTime,
        $lte: endTime,
      };
    }

    // Search filter
    if (search && search.value) {
      query.$or = [
        { vehicle_name: new RegExp(search.value, "i") },
        { lpn: new RegExp(search.value, "i") },
        { alarm_type: new RegExp(search.value, "i") },
      ];
    }

    // Count total & filtered
    const recordsTotal = await ADAS.countDocuments({});
    const recordsFiltered = await ADAS.countDocuments(query);

    // Sort (default: event_time descending)
    let sort = { event_time: -1 };
    if (order && order[0]) {
      const orderColumn = columns[order[0].column].data;
      const orderDir = order[0].dir === "asc" ? 1 : -1;
      sort = { [orderColumn]: orderDir };
    }

    // Fetch data with pagination
    const data = await ADAS.find(query)
      .sort(sort)
      .skip(parseInt(start) || 0)
      .limit(parseInt(length) || 25)
      .lean();

    res.json({
      draw: parseInt(draw),
      recordsTotal,
      recordsFiltered,
      data,
    });
  } catch (err) {
    console.error("Error fetching ADAS datatable:", err);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// API: Get DSM data for DataTables (server-side processing)
app.get("/api/dsm/datatable", async (req, res) => {
  try {
    const { draw, start, length, search, order, columns, vehicle, hours, startDate, endDate } = req.query;

    // Build base query
    let query = {};

    // Filter by vehicle
    if (vehicle && vehicle !== "all") {
      query.vehicle_name = new RegExp(vehicle, "i");
    }

    // Filter by date range
    let startTime, endTime;
    if (startDate && endDate) {
      startTime = new Date(startDate);
      endTime = new Date(endDate);
    } else if (hours) {
      const h = parseInt(hours) || 24;
      endTime = new Date();
      startTime = new Date(endTime.getTime() - h * 60 * 60 * 1000);
    }

    if (startTime && endTime) {
      query.event_time = {
        $gte: startTime,
        $lte: endTime,
      };
    }

    // Search filter
    if (search && search.value) {
      query.$or = [
        { vehicle_name: new RegExp(search.value, "i") },
        { lpn: new RegExp(search.value, "i") },
        { alarm_type: new RegExp(search.value, "i") },
      ];
    }

    // Count total & filtered
    const recordsTotal = await DSM.countDocuments({});
    const recordsFiltered = await DSM.countDocuments(query);

    // Sort (default: event_time descending)
    let sort = { event_time: -1 };
    if (order && order[0]) {
      const orderColumn = columns[order[0].column].data;
      const orderDir = order[0].dir === "asc" ? 1 : -1;
      sort = { [orderColumn]: orderDir };
    }

    // Fetch data with pagination
    const data = await DSM.find(query)
      .sort(sort)
      .skip(parseInt(start) || 0)
      .limit(parseInt(length) || 25)
      .lean();

    res.json({
      draw: parseInt(draw),
      recordsTotal,
      recordsFiltered,
      data,
    });
  } catch (err) {
    console.error("Error fetching DSM datatable:", err);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// API: Get data availability (which dates have data for a vehicle/collection)
app.get("/api/data-availability", async (req, res) => {
  try {
    const { vehicle, type = "adas" } = req.query;
    const Model = type === "dsm" ? DSM : ADAS;

    let matchStage = {};
    if (vehicle && vehicle !== "all") {
      matchStage.vehicle_name = new RegExp(vehicle, "i");
    }

    // Get date range with data counts
    const availability = await Model.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$event_time" }
          },
          count: { $sum: 1 },
          earliest: { $min: "$event_time" },
          latest: { $max: "$event_time" },
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 365 }
    ]);

    // Also get overall date range
    const dateRange = await Model.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          earliest: { $min: "$event_time" },
          latest: { $max: "$event_time" },
          total: { $sum: 1 }
        }
      }
    ]);

    res.json({
      dates: availability.map(d => ({ date: d._id, count: d.count })),
      range: dateRange[0] || { earliest: null, latest: null, total: 0 }
    });
  } catch (err) {
    console.error("Error fetching data availability:", err);
    res.status(500).json({ error: err.message });
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

    const history = await Coordinate.find(query).sort({ event_time: -1 }).limit(parseInt(limit));

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

// API: Get coordinate summary (speed rata-rata, mileage diff, satellites rata-rata)
app.get("/api/coordinates/summary", async (req, res) => {
  try {
    const { hours, startDate, endDate } = req.query;

    let startTime, endTime;

    if (startDate && endDate) {
      // Mode custom tanggal
      startTime = new Date(startDate);
      endTime = new Date(endDate);
    } else {
      // Mode last X hours
      const h = parseInt(hours) || 1;
      endTime = new Date();
      startTime = new Date(endTime.getTime() - h * 60 * 60 * 1000);
    }

    // Aggregate per vehicle
    const summary = await Coordinate.aggregate([
      {
        $match: {
          event_time: { $gte: startTime, $lte: endTime },
        },
      },
      {
        $sort: { event_time: 1 }, // Sort ascending buat ambil first & last
      },
      {
        $group: {
          _id: "$vehicle_name",
          vehicle_name: { $first: "$vehicle_name" },
          avg_speed: { $avg: "$speed" },
          first_mileage: { $first: "$mileage" },
          last_mileage: { $last: "$mileage" },
          avg_satellites: { $avg: "$additional.satellites" },
          data_count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          vehicle_name: 1,
          avg_speed: 1,
          mileage_diff: { $subtract: ["$last_mileage", "$first_mileage"] },
          avg_satellites: 1,
          data_count: 1,
        },
      },
      {
        $sort: { vehicle_name: 1 },
      },
    ]);

    res.json(summary);
  } catch (err) {
    console.error("Error fetching coordinate summary:", err);
    res.status(500).json({ message: "Failed to fetch summary" });
  }
});

// API: Get vehicle safety score
app.get("/api/safety/vehicle-score/:vehicleName", async (req, res) => {
  try {
    const { vehicleName } = req.params;
    const { hours = 1 } = req.query;
    const vehicleScore = await safetyScoreService.calculateVehicleScore(vehicleName, parseInt(hours));
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

// Middleware: Check video service auth
function checkVideoAuth(req, res, next) {
  const status = videoStreamService.getStatus();

  if (!status.hasAuth) {
    return res.status(503).json({
      error: "Video service not ready. Authentication in progress...",
      status: status,
    });
  }

  next();
}

// API: Get stream URL from Gateway
app.get("/api/video/stream-url/:imei/:channel", checkVideoAuth, async (req, res) => {
  try {
    const { imei, channel } = req.params;
    const streamInfo = await videoStreamService.getStreamInfo(imei, parseInt(channel));

    res.json({
      imei,
      channel: parseInt(channel),
      ...streamInfo,
    });
  } catch (err) {
    console.error("Error getting stream URL:", err);
    res.status(500).json({ error: err.message });
  }
});

// API: Check stream availability
app.get("/api/video/check/:imei/:channel", checkVideoAuth, async (req, res) => {
  try {
    const { imei, channel } = req.params;

    // Check if this is a SoloFleet device
    if (global.__sfVideoService && global.__sfVideoService.isSoloFleetDevice(imei)) {
      const status = global.__sfVideoService.getStreamStatus(imei, parseInt(channel));
      return res.json({
        imei,
        channel: parseInt(channel),
        available: true, // SoloFleet cameras are always "available" (on-demand)
        is_present: true,
        source: "solofleet",
        streaming: status.active,
      });
    }

    const streamInfo = await videoStreamService.getStreamInfo(imei, parseInt(channel));

    res.json({
      imei,
      channel: parseInt(channel),
      available: streamInfo.is_present,
      source: "tgtrack",
      ...streamInfo,
    });
  } catch (err) {
    console.error("Error checking stream:", err);
    res.status(500).json({ error: err.message });
  }
});

// API: Fetch video snapshot
app.get("/api/video/snapshot/:imei/:channel", checkVideoAuth, async (req, res) => {
  try {
    const { imei, channel } = req.params;
    const duration = parseInt(req.query.duration) || 5;

    // Get stream URL from Gateway
    const streamInfo = await videoStreamService.getStreamInfo(imei, parseInt(channel));

    if (!streamInfo.is_present) {
      return res.status(404).json({ error: "Stream not available" });
    }

    // Fetch video buffer
    const videoBuffer = await videoStreamService.fetchStream(streamInfo.http, duration);

    res.set({
      "Content-Type": "video/x-flv",
      "Content-Length": videoBuffer.length,
      "Content-Disposition": `inline; filename="${imei}_camera${channel}.flv"`,
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    });

    res.send(videoBuffer);
  } catch (err) {
    console.error("Error in snapshot endpoint:", err);
    res.status(500).json({ error: err.message });
  }
});

// API: Stream video (live proxy)
app.get("/api/video/stream/:imei/:channel", checkVideoAuth, async (req, res) => {
  try {
    const { imei, channel } = req.params;

    // Get stream URL from Gateway API
    const streamInfo = await videoStreamService.getStreamInfo(imei, parseInt(channel));

    if (!streamInfo.is_present) {
      return res.status(404).json({ error: "Stream not available" });
    }

    console.log(`▶️ Proxying stream: ${streamInfo.http}`);

    // Proxy stream
    const https = require("https");
    const axios = require("axios");
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const response = await axios({
      method: "GET",
      url: streamInfo.http,
      responseType: "stream",
      httpsAgent: httpsAgent,
      headers: {
        Accept: "*/*",
        Origin: "https://ds.tgtrack.com",
        Referer: "https://ds.tgtrack.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 60000,
    });

    res.set({
      "Content-Type": "video/x-flv",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Transfer-Encoding": "chunked",
    });

    response.data.pipe(res);

    response.data.on("error", (err) => {
      console.error("Stream error:", err);
      if (!res.headersSent) res.status(500).end();
    });

    req.on("close", () => {
      console.log("Client disconnected");
      response.data.destroy();
    });
  } catch (err) {
    console.error("Error streaming video:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// API: Get all cameras
app.get("/api/video/cameras/:imei", checkVideoAuth, async (req, res) => {
  try {
    const { imei } = req.params;
    const quick = req.query.quick === "true";

    // Check if this is a SoloFleet device
    if (global.__sfVideoService && global.__sfVideoService.isSoloFleetDevice(imei)) {
      // SoloFleet THE FLASH has 8 cameras (vid_use: 11111111)
      const cameras = Array.from({ length: 8 }, (_, i) => ({
        channel: i + 1,
        available: true,
        source: "solofleet",
        name: `Camera ${i + 1}`,
      }));

      return res.json({
        imei,
        cameras,
        available_count: 8,
        mode: "solofleet",
        source: "solofleet",
      });
    }

    if (quick) {
      // Quick mode: just return camera list
      const cameras = videoStreamService.getCameraList(imei);
      res.json({
        imei,
        cameras,
        mode: "quick",
      });
    } else {
      // Full check mode: check availability from Gateway
      const cameras = await videoStreamService.checkAllCameras(imei);
      const availableCount = cameras.filter((c) => c.available).length;

      res.json({
        imei,
        cameras,
        available_count: availableCount,
        mode: "full",
      });
    }
  } catch (err) {
    console.error("Error checking cameras:", err);
    res.status(500).json({ error: err.message });
  }
});

// API: Get video service status
app.get("/api/video/status", checkVideoAuth, (req, res) => {
  const tgtrackStatus = videoStreamService.getStatus();
  const sfStatus =
    global.__sfVideoService ? global.__sfVideoService.getAllStatus() : [];

  res.json({
    tgtrack: tgtrackStatus,
    solofleet: {
      enabled: !!global.__sfVideoService,
      activeStreams: sfStatus,
    },
  });
});

// API: SoloFleet video stream via WebSocket upgrade
// Client connects to: ws://host:3000/api/video/sf-stream/{imei}/{channel}
// Receives raw H.264 NALUs for JMuxer decoding
app.get("/api/video/sf-stream/:imei/:channel", async (req, res) => {
  // This endpoint is handled by the WebSocket upgrade below
  // If accessed via HTTP, return info
  const { imei, channel } = req.params;

  if (global.__sfVideoService && global.__sfVideoService.isSoloFleetDevice(imei)) {
    const status = global.__sfVideoService.getStreamStatus(imei, parseInt(channel));
    return res.json({
      message: "Use WebSocket to connect to this endpoint",
      wsUrl: `ws://${req.headers.host}/api/video/sf-stream/${imei}/${channel}`,
      ...status,
    });
  }

  res.status(404).json({ error: "Not a SoloFleet device" });
});

// API: SoloFleet start stream (can be called before WS connect)
app.post("/api/video/sf-start/:imei/:channel", async (req, res) => {
  try {
    const { imei, channel } = req.params;

    if (!global.__sfVideoService || !global.__sfVideoService.isSoloFleetDevice(imei)) {
      return res.status(404).json({ error: "Not a SoloFleet device" });
    }

    const session = await global.__sfVideoService.startStream(imei, parseInt(channel));
    res.json({
      success: true,
      deviceChannel: session.deviceChannel,
      wsUrl: `ws://${req.headers.host}/api/video/sf-stream/${imei}/${channel}`,
      connected: session.wsConnected,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: SoloFleet stop stream
app.post("/api/video/sf-stop/:imei/:channel", async (req, res) => {
  try {
    const { imei, channel } = req.params;

    if (!global.__sfVideoService) {
      return res.status(404).json({ error: "SoloFleet not enabled" });
    }

    await global.__sfVideoService.stopStream(imei, parseInt(channel));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get vehicle summary for Command Center (36 hours)
app.get("/api/command-center/vehicles", async (req, res) => {
  try {
    const vehicles = await Vehicle.find({ status: "active" }).select("name imei lpn display_name").lean();

    if (vehicles.length === 0) {
      return res.json([]);
    }

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 36 * 60 * 60 * 1000);

    const summaries = await Promise.all(
      vehicles.map(async (vehicle) => {
        try {
          const { name, imei, lpn } = vehicle;

          // Build query - use IMEI first, fallback to vehicle_name for SoloFleet
          const imeiMatch = { imei: imei, event_time: { $gte: startTime, $lte: endTime } };
          const nameMatch = { vehicle_name: name, event_time: { $gte: startTime, $lte: endTime } };

          // Quick check: does this vehicle have any alarms by IMEI?
          let adasByImei = await ADAS.countDocuments(imeiMatch);
          let dsmByImei = await DSM.countDocuments(imeiMatch);
          
          // Use vehicle_name query if IMEI returns nothing (SoloFleet case)
          const useNameQuery = (adasByImei === 0 && dsmByImei === 0);
          const matchQuery = useNameQuery ? { vehicle_name: name } : { imei: imei };
          const timeMatch = { ...matchQuery, event_time: { $gte: startTime, $lte: endTime } };

          const [adasCount, dsmCount, adasCorrect, dsmCorrect] = await Promise.all([
            ADAS.countDocuments(timeMatch),
            DSM.countDocuments(timeMatch),
            ADAS.countDocuments({
              ...timeMatch,
              validation_status: { $ne: "incorrect" },
            }),
            DSM.countDocuments({
              ...timeMatch,
              validation_status: { $ne: "incorrect" },
            }),
          ]);

          // Also try coordinate by vehicle_name if IMEI fails
          let latestCoord = await Coordinate.findOne({ imei: imei }).sort({ event_time: -1 }).lean();
          if (!latestCoord) {
            latestCoord = await Coordinate.findOne({ vehicle_name: name }).sort({ event_time: -1 }).lean();
          }

          const totalCorrectAlarms = adasCorrect + dsmCorrect;
          const score = Math.max(0, 100 - totalCorrectAlarms * 5);

          return {
            vehicle_name: name,
            display_name: vehicle.display_name || name,
            lpn: lpn,
            alarms: {
              adas: adasCount,
              dsm: dsmCount,
              adas_correct: adasCorrect,
              dsm_correct: dsmCorrect,
              total: adasCount + dsmCount,
              total_correct: totalCorrectAlarms,
            },
            safety_score: score,
            location: latestCoord
              ? {
                  lat: latestCoord.lat,
                  lng: latestCoord.lng,
                  speed: latestCoord.speed || 0,
                  event_time: latestCoord.event_time,
                }
              : null,
            imei: imei,
          };
        } catch (err) {
          console.error(`❌ ${vehicle.name}:`, err.message);
          return {
            vehicle_name: vehicle.name,
            display_name: vehicle.display_name || vehicle.name,
            lpn: vehicle.lpn,
            alarms: { adas: 0, dsm: 0, adas_correct: 0, dsm_correct: 0, total: 0, total_correct: 0 },
            safety_score: 100,
            location: null,
            imei: vehicle.imei,
          };
        }
      })
    );

    res.json(summaries);
  } catch (err) {
    console.error("❌ Error fetching vehicle summaries:", err);
    res.status(500).json({ error: err.message, vehicles: [] });
  }
});

// API: Get vehicle detail with alarms (for modal)
app.get("/api/command-center/vehicle/:vehicleName", async (req, res) => {
  try {
    const { vehicleName } = req.params;
    const vehicle = await Vehicle.findOne({ name: vehicleName }).lean();

    if (!vehicle) {
      return res.status(404).json({ error: "Vehicle not found" });
    }

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 36 * 60 * 60 * 1000);

    // Query by IMEI first, then fallback to vehicle_name for SoloFleet
    // (SoloFleet alarms may have imei="solofleet" instead of actual device IMEI)
    const imeiQuery = { imei: vehicle.imei, event_time: { $gte: startTime, $lte: endTime } };
    const nameQuery = { vehicle_name: vehicleName, event_time: { $gte: startTime, $lte: endTime } };

    let [adasAlarms, dsmAlarms] = await Promise.all([
      ADAS.find(imeiQuery).sort({ event_time: -1 }).limit(50).lean(),
      DSM.find(imeiQuery).sort({ event_time: -1 }).limit(50).lean(),
    ]);

    // Fallback: if no results by IMEI, try by vehicle_name
    if (adasAlarms.length === 0 && dsmAlarms.length === 0) {
      [adasAlarms, dsmAlarms] = await Promise.all([
        ADAS.find(nameQuery).sort({ event_time: -1 }).limit(50).lean(),
        DSM.find(nameQuery).sort({ event_time: -1 }).limit(50).lean(),
      ]);
    }

    res.json({
      vehicle_name: vehicleName,
      imei: vehicle.imei,
      lpn: vehicle.lpn,
      alarms: {
        adas: adasAlarms,
        dsm: dsmAlarms,
      },
    });
  } catch (err) {
    console.error("Error fetching vehicle detail:", err);
    res.status(500).json({ error: err.message });
  }
});

// API: Validate alarm (mark as correct/incorrect)
app.post("/api/command-center/validate-alarm", async (req, res) => {
  try {
    const { alarm_key, alarm_type, status, validated_by } = req.body;

    if (!["correct", "incorrect"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const Model = alarm_type === "ADAS" ? ADAS : DSM;

    const updated = await Model.findOneAndUpdate(
      { alarm_key },
      {
        validation_status: status,
        validated_by: validated_by || "system",
        validated_at: new Date(),
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: "Alarm not found" });
    }

    res.json({
      success: true,
      alarm_key,
      validation_status: status,
      message: `Alarm marked as ${status}`,
    });
  } catch (err) {
    console.error("Error validating alarm:", err);
    res.status(500).json({ error: err.message });
  }
});

// API: Get vehicle alarms with location (for map markers)
app.get("/api/command-center/vehicle-alarms/:vehicleName", async (req, res) => {
  try {
    const { vehicleName } = req.params;
    const vehicle = await Vehicle.findOne({ name: vehicleName }).lean();

    if (!vehicle) {
      return res.status(404).json({ error: "Vehicle not found" });
    }

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 36 * 60 * 60 * 1000);

    // Try by IMEI first, fallback to vehicle_name for SoloFleet
    const baseTimeFilter = { event_time: { $gte: startTime, $lte: endTime }, lat: { $exists: true, $ne: null }, lng: { $exists: true, $ne: null } };
    
    let [adasAlarms, dsmAlarms] = await Promise.all([
      ADAS.find({ imei: vehicle.imei, ...baseTimeFilter }).select("alarm_type lat lng event_time validation_status alarm_key").lean(),
      DSM.find({ imei: vehicle.imei, ...baseTimeFilter }).select("alarm_type lat lng event_time validation_status alarm_key").lean(),
    ]);

    if (adasAlarms.length === 0 && dsmAlarms.length === 0) {
      [adasAlarms, dsmAlarms] = await Promise.all([
        ADAS.find({ vehicle_name: vehicleName, ...baseTimeFilter }).select("alarm_type lat lng event_time validation_status alarm_key").lean(),
        DSM.find({ vehicle_name: vehicleName, ...baseTimeFilter }).select("alarm_type lat lng event_time validation_status alarm_key").lean(),
      ]);
    }

    res.json({
      vehicle_name: vehicleName,
      imei: vehicle.imei,
      alarms: [...adasAlarms.map((a) => ({ ...a, type: "ADAS" })), ...dsmAlarms.map((a) => ({ ...a, type: "DSM" }))],
    });
  } catch (err) {
    console.error("Error fetching vehicle alarms:", err);
    res.status(500).json({ error: err.message });
  }
});

const deduplicateTimeSeries = (existing = [], incoming = [], timeKey = "time") => {
  const existingMap = new Map();
  existing.forEach((item) => {
    existingMap.set(item[timeKey], item);
  });

  incoming.forEach((item) => {
    existingMap.set(item[timeKey], item);
  });

  return Array.from(existingMap.values()).sort((a, b) => new Date(a[timeKey]) - new Date(b[timeKey]));
};

app.post("/api/save-data", async (req, res) => {
  try {
    const {
      current,
      dailySteps,
      dailyCalories,
      heartRateHistory,
      sleepData,
      stressHistory,
      spo2History,
      driverName,
      activityBreakdown,
      timestamp,
      dataHash,
      deviceId,
      syncTime,
    } = req.body;

    if (!deviceId || !timestamp || !driverName) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: deviceId, timestamp, driverName",
      });
    }

    const date = syncTime ? syncTime.split("T")[0] : new Date(timestamp).toISOString().split("T")[0];

    console.log(`[Sync] Driver: ${driverName}, Device: ${deviceId}, Date: ${date}`);
    console.log(
      `[Sync] Incoming - Steps: ${dailySteps?.length || 0}, Calories: ${dailyCalories?.length || 0}, HR: ${
        heartRateHistory?.length || 0
      }, SpO2: ${spo2History?.length || 0}`
    );

    const existingDoc = await HealthData.findOne({
      driverName: driverName,
      deviceId: deviceId,
      date: date,
    });

    let healthData;

    if (existingDoc) {
      console.log(`[Sync] Merging with existing document...`);

      const mergedDailySteps = deduplicateTimeSeries(existingDoc.dailySteps || [], dailySteps || [], "date");
      const mergedDailyCalories = deduplicateTimeSeries(existingDoc.dailyCalories || [], dailyCalories || [], "date");
      const mergedHeartRateHistory = deduplicateTimeSeries(
        existingDoc.heartRateHistory || [],
        heartRateHistory || [],
        "time"
      );
      const mergedSpo2History = deduplicateTimeSeries(existingDoc.spo2History || [], spo2History || [], "time");
      const mergedSleepData = deduplicateTimeSeries(existingDoc.sleepData || [], sleepData || [], "date");
      const mergedStressHistory = deduplicateTimeSeries(existingDoc.stressHistory || [], stressHistory || [], "time");

      console.log(
        `[Sync] After merge - Steps: ${mergedDailySteps.length}, Calories: ${mergedDailyCalories.length}, HR: ${mergedHeartRateHistory.length}, SpO2: ${mergedSpo2History.length}`
      );

      healthData = await HealthData.findOneAndUpdate(
        {
          driverName: driverName,
          deviceId: deviceId,
          date: date,
        },
        {
          steps: current?.steps || 0,
          heartRate: current?.heartRate || 0,
          spo2: current?.spo2 || 0,
          stress: current?.stress || 0,
          distance: current?.distance || 0,
          calories: current?.calories || 0,
          vitality: current?.vitality || 0,

          dailySteps: mergedDailySteps,
          dailyCalories: mergedDailyCalories,
          heartRateHistory: mergedHeartRateHistory,
          spo2History: mergedSpo2History,
          sleepData: mergedSleepData,
          stressHistory: mergedStressHistory,

          activityBreakdown: activityBreakdown || {},
          timestamp: timestamp,
          dataHash: dataHash,
          syncTime: syncTime,
          updatedAt: new Date(),
        },
        {
          new: true,
          runValidators: true,
        }
      );

      console.log(`🔄 UPDATED Health data: ${deviceId} - ${driverName} - ${date}`);

      res.json({
        success: true,
        message: "Health data updated successfully",
        isNew: false,
        data: {
          id: healthData._id,
          deviceId: healthData.deviceId,
          driverName: healthData.driverName,
          date: healthData.date,
          steps: healthData.steps,
          heartRate: healthData.heartRate,
          heartRateHistoryCount: healthData.heartRateHistory?.length || 0,
          spo2HistoryCount: healthData.spo2History?.length || 0,
          dailyStepsCount: healthData.dailySteps?.length || 0,
          dailyCaloriesCount: healthData.dailyCalories?.length || 0,
          timestamp: healthData.timestamp,
          syncTime: healthData.syncTime,
        },
      });
    } else {
      console.log(`[Sync] Creating new document...`);

      healthData = new HealthData({
        driverName: driverName,
        deviceId: deviceId,
        date: date,

        steps: current?.steps || 0,
        heartRate: current?.heartRate || 0,
        spo2: current?.spo2 || 0,
        stress: current?.stress || 0,
        distance: current?.distance || 0,
        calories: current?.calories || 0,
        vitality: current?.vitality || 0,

        dailySteps: deduplicateTimeSeries([], dailySteps || [], "date"),
        dailyCalories: deduplicateTimeSeries([], dailyCalories || [], "date"),
        heartRateHistory: deduplicateTimeSeries([], heartRateHistory || [], "time"),
        spo2History: deduplicateTimeSeries([], spo2History || [], "time"),
        sleepData: deduplicateTimeSeries([], sleepData || [], "date"),
        stressHistory: deduplicateTimeSeries([], stressHistory || [], "time"),

        activityBreakdown: activityBreakdown || {},
        timestamp: timestamp,
        dataHash: dataHash,
        syncTime: syncTime,
      });

      await healthData.save();

      console.log(`✅ NEW Health data: ${deviceId} - ${driverName} - ${date}`);

      res.json({
        success: true,
        message: "Health data saved successfully",
        isNew: true,
        data: {
          id: healthData._id,
          deviceId: healthData.deviceId,
          driverName: healthData.driverName,
          date: healthData.date,
          steps: healthData.steps,
          heartRate: healthData.heartRate,
          heartRateHistoryCount: healthData.heartRateHistory?.length || 0,
          spo2HistoryCount: healthData.spo2History?.length || 0,
          dailyStepsCount: healthData.dailySteps?.length || 0,
          dailyCaloriesCount: healthData.dailyCalories?.length || 0,
          timestamp: healthData.timestamp,
          syncTime: healthData.syncTime,
        },
      });
    }
  } catch (err) {
    console.error("❌ Error saving health data:", err);

    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate data detected",
        error: err.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to save health data",
      error: err.message,
    });
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
const server = app.listen(PORT, () => {
  console.log(`Express listening on port ${PORT}`);
});

// WebSocket upgrade handler
// Routes:
//   /ws/copilot → Copilot alarm/GPS WebSocket
//   /api/video/sf-stream/{imei}/{channel} → SoloFleet video WebSocket
const sfVideoWss = new (require("ws").Server)({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  // Route 1: Copilot WebSocket
  if (url.pathname === "/ws/copilot") {
    const copilotWss = getWss();
    if (copilotWss) {
      copilotWss.handleUpgrade(request, socket, head, (ws) => {
        copilotWss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
    return;
  }

  // Route 2: SoloFleet Video WebSocket
  const match = url.pathname.match(
    /^\/api\/video\/sf-stream\/([^/]+)\/(\d+)$/
  );

  if (!match) {
    socket.destroy();
    return;
  }

  const imei = match[1];
  const channel = parseInt(match[2]);

  sfVideoWss.handleUpgrade(request, socket, head, async (ws) => {
    // sfVideoService is set inside main() — check if available via global
    const svc = global.__sfVideoService;
    if (!svc || !svc.isSoloFleetDevice(imei)) {
      ws.close(1008, "Not a SoloFleet device or service not ready");
      return;
    }

    try {
      console.log(
        `[SF-Video] 🎥 WS client requesting: ${imei} ch${channel}`
      );

      // Start stream if not already active
      const session = await svc.startStream(imei, channel);

      // Add this client to receive H.264 data
      session.addClient(ws);

      ws.on("close", () => {
        console.log(
          `[SF-Video] 🎥 WS client disconnected: ${imei} ch${channel}`
        );
      });
    } catch (err) {
      console.error(`[SF-Video] WS error:`, err.message);
      ws.close(1011, err.message);
    }
  });
});

// Wait until next 15-second interval (00, 15, 30, 45)
async function waitUntilNext15Seconds() {
  const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_SEC || "5") * 1000;
  const waitSec = POLL_INTERVAL_MS / 1000;
  console.log(`⏰ Tunggu ${waitSec}s untuk cycle berikutnya...`);
  await sleep(POLL_INTERVAL_MS);
}

// Format date to API-compatible format with timezone
function formatTime(date) {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}+07:00`;
}

// ============================================================
// SOLOFLEET API ENDPOINTS
// ============================================================

// API: Get SoloFleet worker status
app.get("/api/solofleet/status", (req, res) => {
  try {
    // solofleetWorker is initialized inside main(), check if available globally
    res.json({
      enabled: config.solofleet.enabled,
      baseUrl: config.solofleet.baseUrl,
      message: config.solofleet.enabled
        ? "SoloFleet worker is running"
        : "SoloFleet is disabled",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get combined fleet stats (TGTrack + SoloFleet)
app.get("/api/fleet/combined-stats", async (req, res) => {
  try {
    const { hours = 24 } = req.query;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const [adasCount, dsmCount, vehicleCount, tgtrackAlarms, solofleetAlarms] =
      await Promise.all([
        ADAS.countDocuments({ event_time: { $gte: since } }),
        DSM.countDocuments({ event_time: { $gte: since } }),
        Vehicle.countDocuments({ status: "active" }),
        ADAS.countDocuments({
          event_time: { $gte: since },
          alarm_key: { $not: /^sf_/ },
        }),
        ADAS.countDocuments({
          event_time: { $gte: since },
          alarm_key: /^sf_/,
        }).then(async (adasSf) => {
          const dsmSf = await DSM.countDocuments({
            event_time: { $gte: since },
            alarm_key: /^sf_/,
          });
          return adasSf + dsmSf;
        }),
      ]);

    res.json({
      period_hours: parseInt(hours),
      total_alarms: adasCount + dsmCount,
      adas_alarms: adasCount,
      dsm_alarms: dsmCount,
      active_vehicles: vehicleCount,
      sources: {
        tgtrack: tgtrackAlarms,
        solofleet: await solofleetAlarms,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get alarms by source (tgtrack or solofleet)
app.get("/api/alarms/by-source/:source", async (req, res) => {
  try {
    const { source } = req.params;
    const { limit = 50, hours = 24 } = req.query;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    let query = { event_time: { $gte: since } };
    if (source === "solofleet") {
      query.alarm_key = /^sf_/;
    } else if (source === "tgtrack") {
      query.alarm_key = { $not: /^sf_/ };
    }

    const [adasAlarms, dsmAlarms] = await Promise.all([
      ADAS.find(query).sort({ event_time: -1 }).limit(parseInt(limit)).lean(),
      DSM.find(query).sort({ event_time: -1 }).limit(parseInt(limit)).lean(),
    ]);

    const combined = [...adasAlarms, ...dsmAlarms]
      .sort((a, b) => new Date(b.event_time) - new Date(a.event_time))
      .slice(0, parseInt(limit));

    res.json({
      source,
      total: combined.length,
      alarms: combined,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function main() {
  let browser;
  let page;
  let token;
  let organizeId;

  const whatsappService = null;
  let globalQueue = null;
  let coordinateWorker = null; // Deklarasi coordinate worker
  let alarmStoreWorker = null; // Deklarasi alarm store worker

  let lastLoginTime = null;
  const RELOGIN_INTERVAL = 6 * 60 * 60 * 1000;

  try {
    console.log("🚀 Starting DS-TGTrack Monitor Service...\n");
    console.log("launching browser dengan persistent session...");
    browser = await puppeteer.launch(config.browser);
    page = await browser.newPage();

    videoStreamService.setBrowser(browser);

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
      lastLoginTime = Date.now();
      console.log("✓ Sudah login dari session sebelumnya!");
    } else {
      console.log("Belum login, mulai proses login...");

      // ✅ LANGSUNG ke retry loop (TANPA login dulu)
      let loginSuccess = false;
      let loginAttempt = 0;
      const MAX_LOGIN_ATTEMPTS = 5;

      while (!loginSuccess && loginAttempt < MAX_LOGIN_ATTEMPTS) {
        loginAttempt++;
        console.log(`🔐 Login attempt ${loginAttempt}/${MAX_LOGIN_ATTEMPTS}`);

        // Clear cookies di attempt ke-2 dst
        if (loginAttempt > 1) {
          console.log("🧹 Clearing cookies and cache...");
          try {
            const client = await page.target().createCDPSession();
            await client.send("Network.clearBrowserCookies");
            await client.send("Network.clearBrowserCache");
            console.log("✓ Cookies & cache cleared");
          } catch (err) {
            console.warn("⚠ Failed to clear cache/cookies:", err.message);
          }

          console.log("🔄 Reload halaman untuk retry...");
          await page.goto(config.target.url, {
            waitUntil: "networkidle2",
            timeout: 30000,
          });
          await sleep(2000);
        }

        // ✅ LOGIN HANYA DISINI (di dalam loop)
        const loginManager = new LoginManager(config);
        const loginResult = await loginManager.login(page);

        if (loginResult.success) {
          console.log("✓ Login berhasil!");
          loginSuccess = true;
          lastLoginTime = Date.now();
          await sleep(3000);
        } else {
          console.log(`✗ Login attempt ${loginAttempt} gagal, url: ${loginResult.url}`);

          if (loginAttempt < MAX_LOGIN_ATTEMPTS) {
            const delays = [5000, 10000, 30000, 60000];
            const delayMs = delays[loginAttempt - 1] || 60000;
            console.log(`⏳ Retry dalam ${delayMs / 1000} detik...`);
            await sleep(delayMs);
          } else {
            console.log("❌ Max login attempts tercapai");
            throw new Error("LOGIN_FAILED_MAX_ATTEMPTS");
          }
        }
      }
    }

    // ✅ Lanjut ke intercept token
    console.log("tunggu intercept token...");
    await sleep(2000);

    const authData = await interceptAuthData(page);
    token = authData.token;
    organizeId = authData.organizeId || "61a22a23e0584dac";

    videoStreamService.setAuth(token, organizeId);

    console.log("✓ Token dan OrganizeId berhasil diambil\n");

    // Initialize workers
    globalQueue = new AlarmFileQueue(axios, token, organizeId, whatsappService, 5, 300000);
    alarmStoreWorker = new AlarmStoreWorker(axios, token, organizeId, 100);

    // Initialize and start coordinate worker
    coordinateWorker = new CoordinateWorker(axios, token, organizeId);
    coordinateWorker.start(10000); // Fetch coordinates every 10 seconds

    // Initialize websocket
    initWebSocketServer(server); // Attach to HTTP server (port 3000, path /ws/copilot)

    // Initialize SoloFleet worker (if enabled)
    let solofleetWorker = null;
    let sfVideoService = null;
    if (config.solofleet.enabled) {
      solofleetWorker = new SoloFleetWorker(config.solofleet, {
        ADAS,
        DSM,
        Vehicle,
        Coordinate,
      });
      solofleetWorker.start(
        config.solofleet.interval,
        config.solofleet.fetchHistory,
        config.solofleet.historyDays
      );
      console.log("✅ SoloFleet worker started");

      // Initialize SoloFleet Video Service
      sfVideoService = new SoloFleetVideoService(solofleetWorker);
      global.__sfVideoService = sfVideoService; // For WebSocket upgrade handler

      // Register device when vehicle data comes in
      // We do an initial fetch to register the device map
      (async () => {
        try {
          await solofleetWorker.ensureLoggedIn();
          const vehicles = await solofleetWorker.fetchVehicleLive();
          for (const v of vehicles) {
            if (v.deviceid) {
              sfVideoService.registerDevice(
                v.deviceid,
                v.deviceid,
                v.vehicleid
              );
              // Also register by imei string used in our DB
              const imeiKey = v.deviceid.replace(/^0+/, "") || v.deviceid;
              sfVideoService.registerDevice(imeiKey, v.deviceid, v.vehicleid);
            }
          }
          console.log("✅ SoloFleet video service initialized");
        } catch (err) {
          console.error(
            "⚠ SoloFleet video device registration failed:",
            err.message
          );
        }
      })();
    }

    // Fetch and process alarms within time range with pagination
    async function fetchAndProcessRange(startTime, endTime, options = {}) {
      const { includeQueue = true, pageLimit = 200 } = options;

      let pageNo = 1;
      let fetchedTotal = 0;

      console.log(`📡 Fetching safety alarms range ${formatTime(startTime)} -> ${formatTime(endTime)}`);

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
          "sec-ch-ua": '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
        };

        const response = await axios.post("https://ds.tgtrack.com/api/jtt808/alarm/safety", requestData, { headers });
        const safetyData = response.data;

        const rows = safetyData.result?.rows || [];
        const total = safetyData.result?.total || 0;
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

      console.log(`📦 Selesai fetch range. Total rows diproses: ${fetchedTotal}\n`);
    }

    let cycleCount = 0;
    let firstCycle = config.getHistory === "true" || config.getHistory === true;

    while (true) {
      cycleCount++;
      const now = new Date();

      if (lastLoginTime && Date.now() - lastLoginTime >= RELOGIN_INTERVAL) {
        console.log("\n🔄 ========================================");
        console.log("🔄 6 JAM TELAH BERLALU - AUTO RE-LOGIN");
        console.log("🔄 ========================================\n");

        try {
          // 1. PENTING: Stop semua workers DULU sebelum re-login
          // Ini mencegah request dengan token expired
          console.log("⏸️  Pausing workers before re-login...");
          
          if (coordinateWorker) {
            coordinateWorker.stop();
            console.log("  ✓ CoordinateWorker paused");
          }
          
          // Pause alarm processing (jika ada method)
          if (alarmStoreWorker && alarmStoreWorker.pause) {
            alarmStoreWorker.pause();
            console.log("  ✓ AlarmStoreWorker paused");
          }
          
          // Tunggu sebentar untuk memastikan semua request selesai
          await sleep(2000);
          console.log("✓ All workers paused\n");

          console.log("🧹 Clearing cookies and cache...");
          const client = await page.target().createCDPSession();
          await client.send("Network.clearBrowserCookies");
          await client.send("Network.clearBrowserCache");
          console.log("✓ Cookies & cache cleared");

          console.log("🧹 Clearing localStorage and sessionStorage...");
          await page.evaluate(() => {
            localStorage.clear();
            sessionStorage.clear();
          });
          console.log("✓ Storage cleared\n");

          // 2. Navigate ke login page dengan retry dan timeout yang lebih baik
          console.log("🔄 Navigating to login page...");
          let gotoSuccess = false;
          let gotoAttempt = 0;
          const MAX_GOTO_ATTEMPTS = 3;

          while (!gotoSuccess && gotoAttempt < MAX_GOTO_ATTEMPTS) {
            gotoAttempt++;
            try {
              console.log(`  → Attempt ${gotoAttempt}/${MAX_GOTO_ATTEMPTS}...`);
              await page.goto(config.login.url, {
                waitUntil: "networkidle2",
                timeout: 60000, // Tambah timeout jadi 60 detik
              });
              gotoSuccess = true;
              console.log("  ✓ Navigation successful");
            } catch (navErr) {
              console.log(`  ⚠ Navigation failed: ${navErr.message}`);
              if (gotoAttempt < MAX_GOTO_ATTEMPTS) {
                console.log(`  → Retry dalam 5 detik...`);
                await sleep(5000);
              }
            }
          }

          if (!gotoSuccess) {
            throw new Error("Failed to navigate to login page after 3 attempts");
          }

          await sleep(3000);

          // 3. Perform login dengan retry
          let reloginSuccess = false;
          let reloginAttempt = 0;
          const MAX_RELOGIN_ATTEMPTS = 3;

          while (!reloginSuccess && reloginAttempt < MAX_RELOGIN_ATTEMPTS) {
            reloginAttempt++;
            console.log(`🔐 Re-login attempt ${reloginAttempt}/${MAX_RELOGIN_ATTEMPTS}`);

            const loginManager = new LoginManager(config);
            const result = await loginManager.login(page);

            if (result.success) {
              console.log("✓ Re-login berhasil!");
              reloginSuccess = true;

              // 4. Re-intercept token
              console.log("🔑 Re-intercepting token...");
              await sleep(2000);
              const authData = await interceptAuthData(page);
              token = authData.token;
              organizeId = authData.organizeId || "61a22a23e0584dac";

              // 5. Update workers
              console.log("🔄 Updating workers with new token...");
              videoStreamService.setAuth(token, organizeId);

              if (globalQueue) {
                globalQueue.token = token;
                globalQueue.organizeId = organizeId;
              }

              if (coordinateWorker) {
                coordinateWorker.updateAuth(token, organizeId);
                // Restart coordinate worker setelah update auth
                coordinateWorker.start();
                console.log("  ✓ CoordinateWorker restarted");
              }

              if (alarmStoreWorker) {
                alarmStoreWorker.token = token;
                alarmStoreWorker.organizeId = organizeId;
                // Resume alarm processing jika ada method
                if (alarmStoreWorker.resume) {
                  alarmStoreWorker.resume();
                  console.log("  ✓ AlarmStoreWorker resumed");
                }
              }

              // 6. Update waktu login
              lastLoginTime = Date.now();

              console.log("\n✅ Re-login completed successfully!");
              console.log("▶️  All workers restarted with new token");
              console.log("⏰ Next re-login scheduled in 6 hours\n");
              console.log("🔄 ========================================\n");
            } else {
              console.log(`✗ Re-login attempt ${reloginAttempt} gagal: ${result.url}`);

              if (reloginAttempt < MAX_RELOGIN_ATTEMPTS) {
                console.log("⏳ Retry dalam 10 detik...");
                await sleep(10000);
              }
            }
          }

          // 7. Jika semua attempt gagal, throw error untuk trigger restart
          if (!reloginSuccess) {
            throw new Error("RE_LOGIN_FAILED_AFTER_ALL_ATTEMPTS");
          }
        } catch (err) {
          console.error("\n❌ Re-login failed:", err.message);
          console.error("⚠️  Service will restart to recover\n");
          throw err; // Re-throw untuk trigger auto-restart
        }
      }

      if (cycleCount > 1 && globalQueue) {
        console.log("");
      }

      try {
        const endTime = new Date();
        let startTime;

        if (firstCycle) {
          const historyDays = parseInt(process.env.TGTRACK_HISTORY_DAYS) || 60;
          
          // Check if we already have data - if so, only fetch from last stored date
          const latestADAS = await ADAS.findOne({ alarm_key: { $not: /^sf_/ } })
            .sort({ event_time: -1 }).lean();
          const latestDSM = await DSM.findOne({ alarm_key: { $not: /^sf_/ } })
            .sort({ event_time: -1 }).lean();
          
          const latestDate = [latestADAS?.event_time, latestDSM?.event_time]
            .filter(Boolean)
            .sort((a, b) => b - a)[0];
          
          if (latestDate) {
            // Incremental: fetch from last stored date minus 1 hour buffer
            startTime = new Date(latestDate.getTime() - 3600000);
            console.log(`🕒 MODE INCREMENTAL: Fetching from ${startTime.toISOString()} (last stored + buffer)`);
          } else {
            // Full history: no data yet
            const HISTORY_MS = historyDays * 24 * 60 * 60 * 1000;
            startTime = new Date(endTime.getTime() - HISTORY_MS);
            console.log(`🕒 MODE FULL HISTORY: ${historyDays} hari ke belakang`);
          }
          
          console.log("⏳ Fetching historical data... This may take several minutes...");

          await fetchAndProcessRange(startTime, endTime, {
            includeQueue: false,
            pageLimit: 200,
          });

          firstCycle = false;
          console.log("✅ HISTORY MODE COMPLETED! Next cycle will be REALTIME.\n");
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

          if (alarmStoreWorker) {
            alarmStoreWorker.token = token;
            alarmStoreWorker.organizeId = organizeId;
          }
        }
      }

      await waitUntilNext15Seconds();
    }
  } catch (error) {
    console.error("✗ Fatal Error:", error.message);
    console.error(error.stack);
  } finally {
    if (videoStreamService) {
      await videoStreamService.close();
    }

    // Stop coordinate worker saat shutdown
    if (coordinateWorker) {
      coordinateWorker.stop();
    }

    // Stop SoloFleet worker saat shutdown
    if (solofleetWorker) {
      solofleetWorker.stop();
    }

    // Stop SoloFleet video streams
    if (sfVideoService) {
      await sfVideoService.stopAll();
    }

    if (browser) {
      await browser.close();
      console.log("browser ditutup");
    }
  }
}

async function runWithAutoRestart() {
  let restartCount = 0;
  const MAX_RESTARTS = 10;

  while (restartCount < MAX_RESTARTS) {
    try {
      console.log(`\n🚀 Service Starting (Attempt ${restartCount + 1}/${MAX_RESTARTS})\n`);
      await main();
      break;
    } catch (error) {
      restartCount++;
      console.error(`\n❌ Service crashed (attempt ${restartCount}/${MAX_RESTARTS})`);
      console.error(`Error: ${error.message}\n`);

      if (restartCount < MAX_RESTARTS) {
        const restartDelay = Math.min(30000 * restartCount, 300000);
        console.log(`🔄 Restarting in ${restartDelay / 1000} seconds...\n`);
        await sleep(restartDelay);
      } else {
        console.error("❌ Maximum restart attempts reached.");
        process.exit(1);
      }
    }
  }
}

// Start service
runWithAutoRestart();