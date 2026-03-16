// carcentroVideoService.js
// Video streaming proxy for CarCentro (AoooG) DVR cameras
//
// CarCentro streaming protocol (reverse-engineered from portal):
//   1. Login via AjaxSettingParameter → get session authentication
//   2. POST GetDeviceVideoConfig → get available channels per device
//   3. Connect WebSocket to wss://live.aooog.com:9661/
//   4. Send JSON command: { "cmdid": 1, "imei": "...", "channel": N, ... }
//   5. Server sends binary H.264/H.265 frames
//   6. Frames decoded by libffmpeg.wasm on client side
//
// This service:
//   - Manages CarCentro auth session
//   - Proxies WebSocket binary frames to our dashboard clients
//   - Handles stream lifecycle (start/stop/keepalive)
//   - Maps deviceID ↔ IMEI for API calls

const WebSocket = require("ws");
const CarCentroService = require("./carcentroService");
const { EventEmitter } = require("events");

class CarCentroVideoService extends EventEmitter {
  constructor(config) {
    super();
    this.service = new CarCentroService(config);
    this.config = config;
    this.activeStreams = new Map(); // "imei:channel" -> CCStreamSession
    this.deviceConfigCache = new Map(); // deviceID -> video config
    this.deviceConfigCacheTime = new Map();
    this.CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5min

    // AoooG live stream server
    this.WS_URL = "wss://live.aooog.com:9661/";

    this.KEEPALIVE_INTERVAL = 25000; // 25s (WebSocket ping)
    this.STREAM_TIMEOUT = 120000; // 2min no-client auto-close

    // Device mapping: imei -> { deviceID, alias, ... }
    this.deviceMap = new Map();

    this.isReady = false;
  }

  /**
   * Initialize - login to CarCentro
   */
  async init() {
    console.log("📹 [CC-Video] Initializing CarCentro Video Service...");
    const ok = await this.service.login();
    if (ok) {
      this.isReady = true;
      console.log("✅ [CC-Video] Ready");
    } else {
      console.error("❌ [CC-Video] Login failed");
    }
    return ok;
  }

  /**
   * Register a CarCentro device (called from carcentroWorker when track data arrives)
   */
  registerDevice(imei, deviceID, alias) {
    if (!this.deviceMap.has(imei)) {
      this.deviceMap.set(imei, { deviceID, alias, imei });
      console.log(`[CC-Video] 📋 Registered: ${imei} -> deviceID ${deviceID} (${alias})`);
    }
  }

  /**
   * Check if IMEI belongs to a CarCentro device
   */
  isCarCentroDevice(imei) {
    return this.deviceMap.has(imei);
  }

  /**
   * Get deviceID from IMEI
   */
  getDeviceID(imei) {
    return this.deviceMap.get(imei)?.deviceID || null;
  }

  /**
   * Fetch video channel config for a device (with cache)
   */
  async getVideoConfig(deviceID) {
    const now = Date.now();
    const cached = this.deviceConfigCache.get(deviceID);
    const cachedTime = this.deviceConfigCacheTime.get(deviceID);

    if (cached && cachedTime && (now - cachedTime) < this.CONFIG_CACHE_TTL) {
      return cached;
    }

    try {
      await this.service.ensureLoggedIn();
      const config = await this.service.fetchVideoConfig(deviceID);
      if (config && config.length > 0) {
        this.deviceConfigCache.set(deviceID, config);
        this.deviceConfigCacheTime.set(deviceID, now);
      }
      return config || [];
    } catch (err) {
      console.error(`[CC-Video] getVideoConfig(${deviceID}) error:`, err.message);
      return cached || [];
    }
  }

  /**
   * Start a video stream for device + channel
   * @param {string} imei - Device IMEI (as stored in our DB)
   * @param {number} channel - Camera channel number
   * @returns {CCStreamSession}
   */
  async startStream(imei, channel) {
    const streamKey = `${imei}:${channel}`;

    // Reuse existing stream
    if (this.activeStreams.has(streamKey)) {
      const existing = this.activeStreams.get(streamKey);
      existing.lastAccess = Date.now();
      console.log(`[CC-Video] ♻️ Reusing stream: ${streamKey}`);
      return existing;
    }

    // Get deviceID from our map
    const deviceInfo = this.deviceMap.get(imei);
    if (!deviceInfo) {
      throw new Error(`Device ${imei} not registered in CarCentro video service`);
    }

    console.log(`[CC-Video] 🎬 Starting stream: ${imei} ch${channel} (deviceID=${deviceInfo.deviceID})`);

    // Ensure auth is fresh
    await this.service.ensureLoggedIn();

    // Create stream session
    const session = new CCStreamSession({
      imei,
      channel,
      deviceID: deviceInfo.deviceID,
      alias: deviceInfo.alias,
      wsUrl: this.WS_URL,
      authToken: this.service.authToken,
    });

    this.activeStreams.set(streamKey, session);

    // Connect to AoooG live server
    await session.connect();

    // Auto-cleanup on timeout
    session.timeoutCheck = setInterval(() => {
      if (Date.now() - session.lastAccess > this.STREAM_TIMEOUT && session.clients.size === 0) {
        console.log(`[CC-Video] ⏱️ Stream timeout: ${streamKey}`);
        this.stopStream(imei, channel);
      }
    }, 10000);

    this.emit("streamStarted", { imei, channel, deviceID: deviceInfo.deviceID });

    return session;
  }

  /**
   * Stop a video stream
   */
  async stopStream(imei, channel) {
    const streamKey = `${imei}:${channel}`;
    const session = this.activeStreams.get(streamKey);
    if (!session) return;

    console.log(`[CC-Video] ⏹️ Stopping stream: ${streamKey}`);
    session.destroy();
    this.activeStreams.delete(streamKey);
    this.emit("streamStopped", { imei, channel });
  }

  /**
   * Stop all active streams
   */
  async stopAll() {
    for (const [key, session] of this.activeStreams) {
      session.destroy();
    }
    this.activeStreams.clear();
    console.log(`[CC-Video] ⏹️ All streams stopped`);
  }

  /**
   * Get stream status
   */
  getStreamStatus(imei, channel) {
    const streamKey = `${imei}:${channel}`;
    const session = this.activeStreams.get(streamKey);

    if (!session) {
      return { active: false, source: "carcentro" };
    }

    return {
      active: true,
      source: "carcentro",
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
        streamKey: key,
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
 * Individual CarCentro stream session
 * Connects to wss://live.aooog.com:9661/ and proxies frames to dashboard clients
 */
class CCStreamSession {
  constructor({ imei, channel, deviceID, alias, wsUrl, authToken }) {
    this.imei = imei;
    this.channel = channel;
    this.deviceID = deviceID;
    this.alias = alias || imei;
    this.wsUrl = wsUrl;
    this.authToken = authToken;

    this.ws = null;
    this.wsConnected = false;
    this.clients = new Set();
    this.lastAccess = Date.now();
    this.startedAt = new Date();
    this.lastData = null;
    this.bytesReceived = 0;
    this.framesReceived = 0;

    this.keepaliveInterval = null;
    this.timeoutCheck = null;
    this.reconnectAttempts = 0;
    this.maxReconnects = 3;
    this.reconnectTimer = null;

    // Protocol state
    this.handshakeComplete = false;
  }

  /**
   * Connect to AoooG live stream WebSocket
   */
  async connect() {
    return new Promise((resolve, reject) => {
      console.log(`[CC-Video] 🔌 Connecting WS: ${this.wsUrl} (device ${this.imei} ch${this.channel})`);

      try {
        this.ws = new WebSocket(this.wsUrl, {
          headers: {
            Origin: "http://carcentro.aooog.com",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
          },
          // AoooG uses plain ws (not wss in some configs), allow self-signed
          rejectUnauthorized: false,
        });

        this.ws.binaryType = "arraybuffer";

        const connectTimeout = setTimeout(() => {
          if (!this.wsConnected) {
            console.log(`[CC-Video] ⏱️ WS connect timeout: ${this.imei} ch${this.channel}`);
            resolve(); // Don't reject - stream might start later
          }
        }, 15000);

        this.ws.on("open", () => {
          console.log(`[CC-Video] ✅ WS connected: ${this.imei} ch${this.channel}`);
          this.wsConnected = true;
          this.reconnectAttempts = 0;
          clearTimeout(connectTimeout);

          // Send stream request command
          this.sendStreamRequest();

          // Start keepalive
          this.keepaliveInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              try {
                this.ws.ping();
              } catch (e) { /* ignore */ }
            }
          }, 25000);

          resolve();
        });

        this.ws.on("message", (data) => {
          this.lastData = Date.now();
          this.lastAccess = Date.now();

          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

          // Check if this is a JSON control message or binary video data
          if (buffer.length < 500) {
            try {
              const text = buffer.toString("utf8");
              if (text.startsWith("{")) {
                const msg = JSON.parse(text);
                this.handleControlMessage(msg);
                return;
              }
            } catch (e) {
              // Not JSON - treat as binary video data
            }
          }

          // Binary video frame - forward to all clients
          this.framesReceived++;
          this.bytesReceived += buffer.length;

          if (this.framesReceived === 1) {
            console.log(`[CC-Video] 🎥 First frame received: ${this.imei} ch${this.channel} (${buffer.length} bytes)`);
          }

          for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.send(buffer);
              } catch (err) {
                this.clients.delete(client);
              }
            } else {
              this.clients.delete(client);
            }
          }
        });

        this.ws.on("close", (code, reason) => {
          console.log(`[CC-Video] 🔌 WS closed: ${this.imei} ch${this.channel} (code=${code})`);
          this.wsConnected = false;

          // Auto-reconnect if still has clients
          if (this.clients.size > 0 && this.reconnectAttempts < this.maxReconnects) {
            this.reconnectAttempts++;
            const delay = Math.min(2000 * this.reconnectAttempts, 10000);
            console.log(`[CC-Video] 🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
            this.reconnectTimer = setTimeout(() => this.connect(), delay);
          }
        });

        this.ws.on("error", (err) => {
          console.error(`[CC-Video] ❌ WS error: ${this.imei} ch${this.channel}:`, err.message);
          clearTimeout(connectTimeout);
          if (!this.wsConnected) {
            resolve();
          }
        });
      } catch (err) {
        console.error(`[CC-Video] ❌ WS create error:`, err.message);
        resolve();
      }
    });
  }

  /**
   * Send stream request to AoooG live server
   * Protocol based on reverse-engineering the CarCentro portal's decoder.js
   */
  sendStreamRequest() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // The AoooG protocol sends a JSON command to request video stream
    // Based on the network traffic from the portal:
    // - cmdid 1 = start live stream
    // - imei = device IMEI
    // - channel = camera channel number
    // - stream = sub-stream (0=main, 1=sub) for bandwidth control
    const cmd = {
      cmdid: 1,
      imei: this.imei,
      channel: this.channel,
      stream: 1, // sub-stream for lower bandwidth
      audio: 0,  // no audio
    };

    console.log(`[CC-Video] 📡 Sending stream request:`, JSON.stringify(cmd));
    this.ws.send(JSON.stringify(cmd));
  }

  /**
   * Handle JSON control messages from AoooG server
   */
  handleControlMessage(msg) {
    console.log(`[CC-Video] 📩 Control message:`, JSON.stringify(msg));

    if (msg.cmdid === 1 && msg.result !== undefined) {
      if (msg.result === 0) {
        console.log(`[CC-Video] ✅ Stream approved for ${this.imei} ch${this.channel}`);
        this.handshakeComplete = true;

        // Notify clients that stream is ready
        const readyMsg = JSON.stringify({
          type: "stream_ready",
          imei: this.imei,
          channel: this.channel,
          codec: msg.codec || "h264",
        });
        for (const client of this.clients) {
          if (client.readyState === WebSocket.OPEN) {
            try { client.send(readyMsg); } catch (e) { /* ignore */ }
          }
        }
      } else {
        console.error(`[CC-Video] ❌ Stream rejected: result=${msg.result}`);
      }
    }
  }

  /**
   * Add a dashboard client WebSocket
   */
  addClient(clientWs) {
    this.clients.add(clientWs);
    this.lastAccess = Date.now();

    clientWs.on("close", () => {
      this.clients.delete(clientWs);
      console.log(`[CC-Video] 👤 Client left: ${this.imei} ch${this.channel} (${this.clients.size} remaining)`);
    });

    console.log(`[CC-Video] 👤 Client joined: ${this.imei} ch${this.channel} (${this.clients.size} total)`);

    // If stream is already active, send ready message
    if (this.handshakeComplete) {
      try {
        clientWs.send(JSON.stringify({
          type: "stream_ready",
          imei: this.imei,
          channel: this.channel,
        }));
      } catch (e) { /* ignore */ }
    }
  }

  /**
   * Destroy this session
   */
  destroy() {
    if (this.keepaliveInterval) clearInterval(this.keepaliveInterval);
    if (this.timeoutCheck) clearInterval(this.timeoutCheck);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    // Send stop command before closing
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          cmdid: 2, // stop stream
          imei: this.imei,
          channel: this.channel,
        }));
      } catch (e) { /* ignore */ }
    }

    // Close all client connections
    for (const client of this.clients) {
      try { client.close(1000, "Stream ended"); } catch (e) { /* ignore */ }
    }
    this.clients.clear();

    // Close upstream WebSocket
    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* ignore */ }
      this.ws = null;
    }

    this.wsConnected = false;
    console.log(`[CC-Video] 🔒 Session destroyed: ${this.imei} ch${this.channel}`);
  }
}

module.exports = CarCentroVideoService;
