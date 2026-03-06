// ws-server.js
// WebSocket server yang bisa jalan standalone ATAU attach ke HTTP server
const WebSocket = require("ws");

let wss = null;
const clients = new Set();

// Allowed origins for WebSocket connections
const allowedWsOrigins = [
  'https://trans.j99t.tech',
  'https://j99t.tech',
  'https://adas.j99t.tech',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:3000'
];

// Verify WebSocket client origin
function verifyClient(info, callback) {
  const origin = info.origin || info.req.headers.origin;
  
  // Allow connections with no origin (non-browser clients)
  if (!origin) {
    return callback(true);
  }
  
  // Check if origin is allowed
  if (allowedWsOrigins.includes(origin)) {
    return callback(true);
  }
  
  // Log but allow for development (tighten in production)
  console.log(`⚠️ WebSocket connection from: ${origin}`);
  return callback(true); // Allow all for now
}

// Initialize WebSocket Server
// Option 1: Standalone port (backward compat)
// Option 2: Attach to existing HTTP server (for Cloudflare tunnel)
function initWebSocketServer(portOrServer = 8008) {
  if (wss) {
    console.log("⚠️ WebSocket server already initialized");
    return wss;
  }

  if (typeof portOrServer === "number") {
    // Standalone mode (backward compat)
    wss = new WebSocket.Server({ 
      port: portOrServer,
      verifyClient: verifyClient
    });
    wss.on("listening", () => {
      console.log(`🔌 WebSocket server listening on ws://localhost:${portOrServer}`);
    });
  } else {
    // Attached to HTTP server - uses noServer mode
    wss = new WebSocket.Server({ 
      noServer: true,
      verifyClient: verifyClient
    });
    console.log("🔌 WebSocket server attached to HTTP server (path: /ws/copilot)");
  }

  wss.on("connection", (ws, req) => {
    clients.add(ws);
    const origin = req.headers.origin || 'unknown';
    console.log(`✅ Copilot client connected from ${origin} (total: ${clients.size})`);

    ws.send(JSON.stringify({ type: "system", message: "Connected to alarm system" }));

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`❌ Copilot client disconnected (remaining: ${clients.size})`);
    });

    ws.on("error", (error) => {
      console.error("WebSocket client error:", error);
    });
  });

  wss.on("error", (error) => {
    console.error("WebSocket Server error:", error);
  });

  return wss;
}

// Get the WSS instance (for upgrade handling)
function getWss() {
  return wss;
}

// Broadcast DSM alarm
function broadcastDSM(alarm, alarmType, speed) {
  const data = { type: "dsm", alarm, alarmType, speed };
  let count = 0;
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) { client.send(JSON.stringify(data)); count++; }
  });
  if (count > 0) console.log(`📡 DSM broadcast to ${count} client(s)`);
}

// Broadcast alarm to Copilot
function broadcastToCopilot(alarm, alarmType, alarmCategory, speed) {
  const copilotData = {
    platform_alarm_id: alarm.platform_alarm_id,
    vehicle_name: alarm.vehicle_name,
    lpn: alarm.lpn,
    alarmType,
    alarmCategory,
    metadata: {
      speed,
      event_time: alarm.event_time,
      location: alarm.additional?.location,
      driver_name: alarm.driver_name,
    },
  };

  let count = 0;
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "copilot_alarm", data: copilotData }));
      count++;
    }
  });
  if (count > 0) console.log(`📡 Copilot alarm: ${alarmCategory} - ${alarmType} (${count} clients)`);
}

// Broadcast GPS location update
function broadcastGPSUpdate(vehicleId, lat, lng, speed, heading, timestamp) {
  const gpsData = {
    type: "gps_update",
    data: { vehicleId, lat, lng, speed, heading, timestamp: timestamp || Date.now() },
  };

  let count = 0;
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) { client.send(JSON.stringify(gpsData)); count++; }
  });

  if (!broadcastGPSUpdate.logCounter) broadcastGPSUpdate.logCounter = 0;
  broadcastGPSUpdate.logCounter++;
  if (broadcastGPSUpdate.logCounter % 10 === 0) {
    console.log(`📍 GPS broadcast: ${vehicleId} (${count} clients, ${broadcastGPSUpdate.logCounter} total)`);
  }
}

// Broadcast destination update
function broadcastDestination(vehicleId, destination, destinationName) {
  const destData = {
    type: "destination_update",
    data: { vehicleId, destination, destinationName },
  };

  let count = 0;
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) { client.send(JSON.stringify(destData)); count++; }
  });
  console.log(`🎯 Destination: ${vehicleId} → ${destinationName} (${count} clients)`);
}

module.exports = {
  initWebSocketServer,
  getWss,
  broadcastDSM,
  broadcastToCopilot,
  broadcastGPSUpdate,
  broadcastDestination,
};
