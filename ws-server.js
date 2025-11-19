// ws-server.js
const WebSocket = require("ws");

let wss = null;
const clients = new Set();

// Initialize WebSocket Server
function initWebSocketServer(port = 8080) {
  if (wss) {
    console.log("⚠️ WebSocket server already initialized");
    return wss;
  }

  wss = new WebSocket.Server({ port });

  wss.on("listening", () => {
    console.log(`🔌 WebSocket server listening on ws://localhost:${port}`);
  });

  wss.on("connection", (ws) => {
    clients.add(ws);
    console.log(`✅ Client connected (total: ${clients.size})`);

    ws.send(
      JSON.stringify({
        type: "system",
        message: "Connected to alarm system",
      })
    );

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`❌ Client disconnected (remaining: ${clients.size})`);
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

// Broadcast DSM alarm
function broadcastDSM(alarm, alarmType, speed) {
  const data = { type: "dsm", alarm, alarmType, speed };

  let broadcastCount = 0;
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
      broadcastCount++;
    }
  });

  if (broadcastCount > 0) {
    console.log(`📡 DSM broadcast to ${broadcastCount} client(s)`);
  }
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

  let broadcastCount = 0;
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: "copilot_alarm",
          data: copilotData,
        })
      );
      broadcastCount++;
    }
  });

  if (broadcastCount > 0) {
    console.log(`📡 Copilot alarm broadcast: ${alarmCategory} - ${alarmType} (${broadcastCount} clients)`);
  }
}

// Broadcast GPS location update
function broadcastGPSUpdate(vehicleId, lat, lng, speed, heading, timestamp) {
  const gpsData = {
    type: "gps_update",
    data: {
      vehicleId,
      lat,
      lng,
      speed,
      heading,
      timestamp: timestamp || Date.now(),
    },
  };

  let broadcastCount = 0;
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(gpsData));
      broadcastCount++;
    }
  });

  // Log every 10 updates to avoid spam
  if (!broadcastGPSUpdate.logCounter) broadcastGPSUpdate.logCounter = 0;
  broadcastGPSUpdate.logCounter++;

  if (broadcastGPSUpdate.logCounter % 10 === 0) {
    console.log(
      `📍 GPS broadcast: ${vehicleId} (${broadcastCount} clients, ${broadcastGPSUpdate.logCounter} total updates)`
    );
  }
}

// Broadcast destination update
function broadcastDestination(vehicleId, destination, destinationName) {
  const destData = {
    type: "destination_update",
    data: {
      vehicleId,
      destination,
      destinationName,
    },
  };

  let broadcastCount = 0;
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(destData));
      broadcastCount++;
    }
  });

  console.log(`🎯 Destination broadcast: ${vehicleId} → ${destinationName} (${broadcastCount} clients)`);
}

module.exports = {
  initWebSocketServer,
  broadcastDSM,
  broadcastToCopilot,
  broadcastGPSUpdate,
  broadcastDestination,
};
