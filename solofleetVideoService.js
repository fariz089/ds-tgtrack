// solofleetVideoService.js
// Video streaming proxy for SoloFleet DVR cameras
// Flow: switchonsub command → DVR wakes up → WebSocket H.264 stream → proxy to client
//
// SoloFleet streaming protocol:
//   1. POST /Notify/pushsignalRtoapp with deviceidcommaoverride='switchonsub'
//      message = "{deviceid}{channel}" (e.g., "08800000483801")
//   2. DVR starts streaming H.264 NALUs via WebSocket
//   3. Client connects to wss://socket.solofleet.com?uuid={deviceid}{channel}
//   4. Binary frames = raw H.264 NALUs, decoded by JMuxer on client-side
//
// This service:
//   - Manages stream lifecycle (start/stop/ping keepalive)
//   - Provides WebSocket proxy endpoint for the dashboard
//   - Exposes REST API compatible with existing command-center UI

const WebSocket = require("ws");
const axios = require("axios");
const { EventEmitter } = require("events");

class SoloFleetVideoService extends EventEmitter {
  constructor(solofleetWorker) {
    super();
    this.sfWorker = solofleetWorker; // For cookie-based auth
    this.activeStreams = new Map(); // deviceChannel -> StreamSession
    this.deviceId = null; // Will be set from vehicle data
    this.appName = "TrackingReportTCP191"; // Video server name

    // SoloFleet device mapping: imei -> deviceid
    this.deviceMap = new Map();

    this.PING_INTERVAL = 30000; // 30s keepalive
    this.STREAM_TIMEOUT = 120000; // 2min auto-close if no client
    this.WS_URL = "wss://socket.solofleet.com";
  }

  /**
   * Register device mapping from vehicle data
   * Called when vehicle live data is fetched
   */
  registerDevice(imei, deviceId, vehicleId) {
    this.deviceMap.set(imei, { deviceId, vehicleId });
    this.deviceMap.set(deviceId, { deviceId, vehicleId });
    console.log(
      `[SF-Video] 📋 Registered device: ${imei} -> ${deviceId} (${vehicleId})`
    );
  }

  /**
   * Check if an IMEI belongs to a SoloFleet device
   */
  isSoloFleetDevice(imei) {
    return this.deviceMap.has(imei);
  }

  /**
   * Get SoloFleet deviceId from IMEI
   */
  getDeviceId(imei) {
    const entry = this.deviceMap.get(imei);
    return entry?.deviceId || imei;
  }

  /**
   * Send command to SoloFleet video server via pushsignalRtoapp
   */
  async sendCommand(command, deviceChannels) {
    try {
      await this.sfWorker.ensureLoggedIn();

      const message =
        typeof deviceChannels === "string"
          ? deviceChannels
          : deviceChannels.join(",");

      const response = await this.sfWorker.client.post(
        "/Notify/pushsignalRtoapp",
        null,
        {
          params: {
            appname: this.appName,
            withmessagesentbox: null,
            targetvehicleidcomma: null,
            message: message,
            devicetype: null,
            deviceidcommaoverride: command,
          },
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded; charset=UTF-8",
          },
        }
      );

      console.log(
        `[SF-Video] 📡 Command '${command}' sent: ${message} -> ${response.status}`
      );
      return true;
    } catch (err) {
      console.error(`[SF-Video] ❌ Command '${command}' failed:`, err.message);
      return false;
    }
  }

  /**
   * Start a video stream for a specific device channel
   * @param {string} imei - Device IMEI or deviceId
   * @param {number} channel - Camera channel (1-8)
   * @returns {StreamSession} Active stream session
   */
  async startStream(imei, channel) {
    const deviceId = this.getDeviceId(imei);
    const channelStr = String(channel).padStart(2, "0");
    const deviceChannel = `${deviceId}${channelStr}`;

    // Check if already streaming
    if (this.activeStreams.has(deviceChannel)) {
      const existing = this.activeStreams.get(deviceChannel);
      existing.lastAccess = Date.now();
      console.log(`[SF-Video] ♻️ Reusing stream: ${deviceChannel}`);
      return existing;
    }

    console.log(
      `[SF-Video] 🎬 Starting stream: ${deviceChannel} (${imei} ch${channel})`
    );

    // Step 1: Send switchonsub command to wake up DVR
    const commandSent = await this.sendCommand("switchonsub", deviceChannel);
    if (!commandSent) {
      throw new Error("Failed to send switchonsub command");
    }

    // Step 2: Create stream session
    const session = new StreamSession(
      deviceChannel,
      deviceId,
      channel,
      this.WS_URL
    );

    this.activeStreams.set(deviceChannel, session);

    // Step 3: Connect to SoloFleet WebSocket
    await session.connect();

    // Step 4: Setup keepalive ping
    session.pingInterval = setInterval(async () => {
      await this.sendCommand("ping", deviceChannel);
    }, this.PING_INTERVAL);

    // Step 5: Auto-cleanup on timeout
    session.timeoutCheck = setInterval(() => {
      if (
        Date.now() - session.lastAccess > this.STREAM_TIMEOUT &&
        session.clients.size === 0
      ) {
        console.log(`[SF-Video] ⏱️ Stream timeout: ${deviceChannel}`);
        this.stopStream(imei, channel);
      }
    }, 10000);

    // Emit event
    this.emit("streamStarted", { deviceChannel, imei, channel });

    return session;
  }

  /**
   * Stop a video stream
   */
  async stopStream(imei, channel) {
    const deviceId = this.getDeviceId(imei);
    const channelStr = String(channel).padStart(2, "0");
    const deviceChannel = `${deviceId}${channelStr}`;

    const session = this.activeStreams.get(deviceChannel);
    if (!session) return;

    console.log(`[SF-Video] ⏹️ Stopping stream: ${deviceChannel}`);

    // Send switchoffsub
    await this.sendCommand("switchoffsub", deviceChannel);

    // Cleanup session
    session.destroy();
    this.activeStreams.delete(deviceChannel);

    this.emit("streamStopped", { deviceChannel, imei, channel });
  }

  /**
   * Stop all active streams
   */
  async stopAll() {
    const channels = [...this.activeStreams.keys()];
    if (channels.length > 0) {
      await this.sendCommand("switchoffsub", channels.join(","));
    }
    for (const session of this.activeStreams.values()) {
      session.destroy();
    }
    this.activeStreams.clear();
    console.log(`[SF-Video] ⏹️ All streams stopped`);
  }

  /**
   * Get stream status for a device channel
   */
  getStreamStatus(imei, channel) {
    const deviceId = this.getDeviceId(imei);
    const channelStr = String(channel).padStart(2, "0");
    const deviceChannel = `${deviceId}${channelStr}`;

    const session = this.activeStreams.get(deviceChannel);
    if (!session) {
      return {
        active: false,
        deviceChannel,
        source: "solofleet",
      };
    }

    return {
      active: true,
      deviceChannel,
      source: "solofleet",
      connected: session.wsConnected,
      clients: session.clients.size,
      bytesReceived: session.bytesReceived,
      framesReceived: session.framesReceived,
      startedAt: session.startedAt,
      lastData: session.lastData,
    };
  }

  /**
   * Get all active streams status
   */
  getAllStatus() {
    const streams = [];
    for (const [key, session] of this.activeStreams) {
      streams.push({
        deviceChannel: key,
        connected: session.wsConnected,
        clients: session.clients.size,
        bytesReceived: session.bytesReceived,
        framesReceived: session.framesReceived,
        startedAt: session.startedAt,
      });
    }
    return streams;
  }
}

/**
 * Individual stream session - manages WebSocket connection and client distribution
 */
class StreamSession {
  constructor(deviceChannel, deviceId, channel, wsBaseUrl) {
    this.deviceChannel = deviceChannel;
    this.deviceId = deviceId;
    this.channel = channel;
    this.wsBaseUrl = wsBaseUrl;

    this.ws = null;
    this.wsConnected = false;
    this.clients = new Set(); // Connected client WebSockets
    this.lastAccess = Date.now();
    this.startedAt = new Date();
    this.lastData = null;
    this.bytesReceived = 0;
    this.framesReceived = 0;

    this.pingInterval = null;
    this.timeoutCheck = null;
    this.reconnectAttempts = 0;
    this.maxReconnects = 5;
    this.reconnectTimer = null;

    // Buffer for initial keyframe (helps late-joining clients)
    this.headerBuffer = null;
  }

  /**
   * Connect to SoloFleet WebSocket video stream
   */
  async connect() {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.wsBaseUrl}?uuid=${this.deviceChannel}`;
      console.log(`[SF-Video] 🔌 Connecting WS: ${wsUrl}`);

      try {
        this.ws = new WebSocket(wsUrl, {
          headers: {
            Origin: "https://www.solofleet.com",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        this.ws.binaryType = "arraybuffer";

        const connectTimeout = setTimeout(() => {
          if (!this.wsConnected) {
            console.log(
              `[SF-Video] ⏱️ WS connect timeout: ${this.deviceChannel}`
            );
            resolve(); // Resolve anyway - stream might take time to start
          }
        }, 10000);

        this.ws.on("open", () => {
          console.log(`[SF-Video] ✅ WS connected: ${this.deviceChannel}`);
          this.wsConnected = true;
          this.reconnectAttempts = 0;
          clearTimeout(connectTimeout);
          resolve();
        });

        this.ws.on("message", (data) => {
          this.lastData = Date.now();
          this.lastAccess = Date.now();
          this.framesReceived++;

          const buffer = Buffer.isBuffer(data)
            ? data
            : Buffer.from(data);
          this.bytesReceived += buffer.length;

          // Broadcast to all connected clients
          for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.send(buffer);
              } catch (err) {
                // Client disconnected
                this.clients.delete(client);
              }
            } else {
              this.clients.delete(client);
            }
          }
        });

        this.ws.on("close", (code, reason) => {
          console.log(
            `[SF-Video] 🔌 WS closed: ${this.deviceChannel} (${code})`
          );
          this.wsConnected = false;

          // Auto-reconnect if still has clients
          if (this.clients.size > 0 && this.reconnectAttempts < this.maxReconnects) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * this.reconnectAttempts, 5000);
            console.log(
              `[SF-Video] 🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
            );
            this.reconnectTimer = setTimeout(() => this.connect(), delay);
          }
        });

        this.ws.on("error", (err) => {
          console.error(
            `[SF-Video] ❌ WS error: ${this.deviceChannel}:`,
            err.message
          );
          clearTimeout(connectTimeout);
          if (!this.wsConnected) {
            resolve(); // Don't reject - stream might start later
          }
        });
      } catch (err) {
        console.error(`[SF-Video] ❌ WS create error:`, err.message);
        resolve();
      }
    });
  }

  /**
   * Add a client WebSocket to receive stream data
   */
  addClient(clientWs) {
    this.clients.add(clientWs);
    this.lastAccess = Date.now();

    clientWs.on("close", () => {
      this.clients.delete(clientWs);
      console.log(
        `[SF-Video] 👤 Client left: ${this.deviceChannel} (${this.clients.size} remaining)`
      );
    });

    console.log(
      `[SF-Video] 👤 Client joined: ${this.deviceChannel} (${this.clients.size} total)`
    );
  }

  /**
   * Destroy this session and clean up all resources
   */
  destroy() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.timeoutCheck) clearInterval(this.timeoutCheck);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    // Close all client connections
    for (const client of this.clients) {
      try {
        client.close(1000, "Stream ended");
      } catch (e) {
        /* ignore */
      }
    }
    this.clients.clear();

    // Close upstream WebSocket
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        /* ignore */
      }
      this.ws = null;
    }

    this.wsConnected = false;
  }
}

module.exports = SoloFleetVideoService;
