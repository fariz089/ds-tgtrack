// carcentroCCTVService.js
// Live CCTV streaming from CarCentro via Puppeteer screen capture
//
// Flow:
//   1. Open CarCentro portal in Puppeteer page
//   2. Login via cookie injection (aooog_login)
//   3. Navigate to Video tab, click on device
//   4. Capture canvas/video frames as JPEG screenshots
//   5. Stream as MJPEG to dashboard clients
//
// This avoids all mixed content / WebSocket proxy / WASM decoder issues
// because Puppeteer renders everything in its own headless Chrome.

const EventEmitter = require("events");

class CarCentroCCTVService extends EventEmitter {
  constructor(config, browser) {
    super();
    this.config = config;
    this.browser = browser;
    this.baseUrl = config.baseUrl || "http://carcentro.aooog.com";
    this.authToken = Buffer.from(
      JSON.stringify({ name: config.username, pwd: config.password })
    ).toString("base64");

    // Active capture sessions: "imei:channel" -> CaptureSession
    this.sessions = new Map();

    // Shared portal page (logged in, on Video tab)
    this.portalPage = null;
    this.isLoggedIn = false;
    this.isReady = false;

    this.MAX_SESSIONS = 4; // Max concurrent video captures
    this.FRAME_INTERVAL = 500; // ms between frames (2 FPS)
    this.SESSION_TIMEOUT = 300000; // 5 min auto-close
  }

  /**
   * Initialize — just validate config, don't pre-load portal (too slow/unreliable)
   * Each CaptureSession will do its own login + navigation on-demand
   */
  async init() {
    if (!this.browser) {
      console.error("[CC-CCTV] No browser instance");
      return false;
    }

    if (!this.config.username || !this.config.password) {
      console.error("[CC-CCTV] No CarCentro credentials");
      return false;
    }

    this.isLoggedIn = true;
    this.isReady = true;
    console.log("[CC-CCTV] ✅ Ready (sessions will login on-demand)");
    return true;
  }

  /**
   * Start a CCTV capture session for a specific device
   * Opens a new Puppeteer page, navigates to Video tab, starts the stream
   *
   * @param {string} imei - Device IMEI
   * @param {number} channel - Channel number (1-based)
   * @param {string} deviceName - Display name of the device
   * @param {number} deviceID - CarCentro device ID
   * @returns {CaptureSession}
   */
  async startCapture(imei, channel, deviceName, deviceID) {
    const key = `${imei}:${channel}`;

    // Reuse existing session
    if (this.sessions.has(key)) {
      const existing = this.sessions.get(key);
      existing.lastAccess = Date.now();
      console.log(`[CC-CCTV] ♻️ Reusing session: ${key}`);
      return existing;
    }

    if (this.sessions.size >= this.MAX_SESSIONS) {
      // Close oldest session
      let oldest = null;
      let oldestTime = Infinity;
      for (const [k, s] of this.sessions) {
        if (s.lastAccess < oldestTime) {
          oldest = k;
          oldestTime = s.lastAccess;
        }
      }
      if (oldest) {
        await this.stopCapture(oldest.split(":")[0], parseInt(oldest.split(":")[1]));
      }
    }

    console.log(`[CC-CCTV] 🎬 Starting capture: ${deviceName} ch${channel} (${imei})`);

    const session = new CaptureSession({
      browser: this.browser,
      baseUrl: this.baseUrl,
      authToken: this.authToken,
      username: this.config.username,
      imei,
      channel,
      deviceName,
      deviceID,
      frameInterval: this.FRAME_INTERVAL,
    });

    this.sessions.set(key, session);

    try {
      await session.start();
    } catch (err) {
      console.error(`[CC-CCTV] Start capture error: ${err.message}`);
      this.sessions.delete(key);
      throw err;
    }

    // Auto-cleanup timeout
    session._timeout = setInterval(() => {
      if (Date.now() - session.lastAccess > this.SESSION_TIMEOUT && session.clients.size === 0) {
        console.log(`[CC-CCTV] ⏱️ Session timeout: ${key}`);
        this.stopCapture(imei, channel);
      }
    }, 30000);

    return session;
  }

  /**
   * Stop a capture session
   */
  async stopCapture(imei, channel) {
    const key = `${imei}:${channel}`;
    const session = this.sessions.get(key);
    if (!session) return;

    console.log(`[CC-CCTV] ⏹️ Stopping capture: ${key}`);
    await session.destroy();
    this.sessions.delete(key);
  }

  /**
   * Stop all sessions
   */
  async stopAll() {
    for (const [key, session] of this.sessions) {
      await session.destroy();
    }
    this.sessions.clear();
    if (this.portalPage) {
      try { await this.portalPage.close(); } catch (e) {}
      this.portalPage = null;
    }
    console.log("[CC-CCTV] ⏹️ All sessions stopped");
  }

  getStatus() {
    return {
      ready: this.isReady,
      loggedIn: this.isLoggedIn,
      activeSessions: this.sessions.size,
      sessions: [...this.sessions.entries()].map(([k, s]) => ({
        key: k,
        deviceName: s.deviceName,
        capturing: s.isCapturing,
        clients: s.clients.size,
        framesTotal: s.framesTotal,
      })),
    };
  }
}

/**
 * Individual capture session
 * Opens its own Puppeteer page, navigates to the device video, captures frames
 */
class CaptureSession {
  constructor({ browser, baseUrl, authToken, username, imei, channel, deviceName, deviceID, frameInterval }) {
    this.browser = browser;
    this.baseUrl = baseUrl;
    this.authToken = authToken;
    this.username = username;
    this.imei = imei;
    this.channel = channel;
    this.deviceName = deviceName;
    this.deviceID = deviceID;
    this.frameInterval = frameInterval || 500;

    this.page = null;
    this.isCapturing = false;
    this.captureTimer = null;
    this._timeout = null;
    this.lastAccess = Date.now();
    this.framesTotal = 0;
    this.lastFrame = null; // Latest JPEG buffer
    this.clients = new Set(); // MJPEG response objects
  }

  /**
   * Start: open page, login, navigate to Video tab, click device, start capturing
   */
  async start() {
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1366, height: 768 });
    await this.page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
    );

    const domain = new URL(this.baseUrl).hostname;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // Step 1: Set login cookies before any navigation
    await this.page.setCookie(
      { name: "aooog_login", value: this.authToken, domain, path: "/" },
      { name: "aooog_cookie_lng", value: "en", domain, path: "/" },
      { name: "account_name", value: this.username, domain, path: "/" },
    );

    // Step 2: Call Login API from page context first (sets server session)
    console.log(`[CC-CCTV] Logging in for ${this.deviceName}...`);
    await this.page.goto(this.baseUrl + "/login/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(2000);

    // Do the login API call from browser context
    await this.page.evaluate(async (authToken, baseUrl) => {
      const localTime = new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" });
      const params = new URLSearchParams({
        authentication: authToken,
        localTime: localTime,
        "domain[]": new URL(baseUrl).hostname,
        _: Date.now().toString(),
      });
      try {
        await fetch(baseUrl + "/AoooG_WebService.svc/Login?" + params.toString(), { credentials: "include" });
      } catch (e) { console.log("Login fetch error:", e); }
    }, this.authToken, this.baseUrl);

    await sleep(1000);

    // Step 3: Navigate to main portal
    console.log(`[CC-CCTV] Navigating to portal for ${this.deviceName}...`);
    await this.page.goto(this.baseUrl + "/#", { waitUntil: "domcontentloaded", timeout: 60000 });
    // Wait for portal JS to load and initialize
    await sleep(8000);

    console.log(`[CC-CCTV] Portal loaded. URL: ${this.page.url()}`);

    // Step 4: Click Video tab
    try {
      const clickedVideo = await this.page.evaluate(() => {
        // Look for the Video tab specifically
        const links = document.querySelectorAll("a[href], span, div");
        for (const el of links) {
          const text = el.textContent.trim();
          if (text === "Video" && el.offsetParent !== null) {
            el.click();
            return "clicked-text";
          }
        }
        // Try by class/id patterns
        const videoTab = document.querySelector('[data-options*="Video"], .tabs-title:contains("Video")');
        if (videoTab) { videoTab.click(); return "clicked-selector"; }
        return "not-found";
      });
      console.log(`[CC-CCTV] Video tab click: ${clickedVideo}`);
      await sleep(3000);
    } catch (err) {
      console.warn(`[CC-CCTV] Could not click Video tab: ${err.message}`);
    }

    // Step 5: Find and click on the device
    console.log(`[CC-CCTV] Looking for device: ${this.deviceName}...`);
    try {
      // Extract the bus name (after the dash, e.g., "TWEETY" from "N 7187 UG-TWEETY")
      const busName = this.deviceName.includes("-") ? this.deviceName.split("-").pop().trim() : this.deviceName;

      const clickedDevice = await this.page.evaluate((fullName, shortName) => {
        const elements = document.querySelectorAll("tr td, .tree-title, .datagrid-cell, span");
        for (const el of elements) {
          const text = el.textContent.trim();
          if ((text.includes(fullName) || text.includes(shortName)) && el.offsetParent !== null) {
            // Try double-click (some grids need dblclick to open video)
            el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
            el.click();
            return text;
          }
        }
        return null;
      }, this.deviceName, busName);

      if (clickedDevice) {
        console.log(`[CC-CCTV] Clicked device: "${clickedDevice}"`);
      } else {
        console.warn(`[CC-CCTV] Device "${this.deviceName}" not found in video list`);
      }

      await sleep(8000); // Wait for video player to initialize and connect
    } catch (err) {
      console.warn(`[CC-CCTV] Could not click device: ${err.message}`);
    }

    // Step 6: Start frame capture loop
    this.isCapturing = true;
    this.captureLoop();

    console.log(`[CC-CCTV] ✅ Capture started: ${this.deviceName} ch${this.channel}`);
  }

  /**
   * Capture loop — takes screenshots at regular intervals
   */
  async captureLoop() {
    if (!this.isCapturing || !this.page) return;

    try {
      // Try to screenshot just the video area, fallback to full page
      let frame;

      // Look for video/canvas elements
      const videoRect = await this.page.evaluate(() => {
        // Try to find the DVR player canvas or video container
        const selectors = [
          "canvas",
          ".dvr_player_box",
          ".dvr-player",
          '[class*="video"]',
          '[class*="player"]',
          ".panel-body",
        ];

        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetWidth > 100 && el.offsetHeight > 100) {
            const rect = el.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          }
        }
        return null;
      });

      if (videoRect && videoRect.width > 100 && videoRect.height > 100) {
        frame = await this.page.screenshot({
          type: "jpeg",
          quality: 70,
          clip: {
            x: Math.max(0, videoRect.x),
            y: Math.max(0, videoRect.y),
            width: Math.min(videoRect.width, 1366),
            height: Math.min(videoRect.height, 768),
          },
        });
      } else {
        // Full page screenshot
        frame = await this.page.screenshot({
          type: "jpeg",
          quality: 60,
        });
      }

      this.lastFrame = frame;
      this.framesTotal++;
      this.lastAccess = Date.now();

      // Send to all MJPEG clients
      for (const client of this.clients) {
        try {
          client.write(`--boundary\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
          client.write(frame);
          client.write("\r\n");
        } catch (e) {
          this.clients.delete(client);
        }
      }
    } catch (err) {
      if (err.message.includes("detached") || err.message.includes("closed")) {
        this.isCapturing = false;
        return;
      }
      // Non-fatal error, continue
    }

    // Schedule next frame
    if (this.isCapturing) {
      this.captureTimer = setTimeout(() => this.captureLoop(), this.frameInterval);
    }
  }

  /**
   * Add an MJPEG client (Express response object)
   */
  addClient(res) {
    this.clients.add(res);
    this.lastAccess = Date.now();

    res.on("close", () => {
      this.clients.delete(res);
      console.log(`[CC-CCTV] Client disconnected: ${this.deviceName} (${this.clients.size} remaining)`);
    });

    console.log(`[CC-CCTV] Client connected: ${this.deviceName} (${this.clients.size} total)`);

    // Send last frame immediately if available
    if (this.lastFrame) {
      try {
        res.write(`--boundary\r\nContent-Type: image/jpeg\r\nContent-Length: ${this.lastFrame.length}\r\n\r\n`);
        res.write(this.lastFrame);
        res.write("\r\n");
      } catch (e) {}
    }
  }

  /**
   * Get single snapshot (latest frame)
   */
  async getSnapshot() {
    if (this.lastFrame) return this.lastFrame;

    // Take a fresh screenshot
    if (this.page) {
      return await this.page.screenshot({ type: "jpeg", quality: 70 });
    }
    return null;
  }

  /**
   * Cleanup
   */
  async destroy() {
    this.isCapturing = false;
    if (this.captureTimer) clearTimeout(this.captureTimer);
    if (this._timeout) clearInterval(this._timeout);

    // Close all clients
    for (const client of this.clients) {
      try { client.end(); } catch (e) {}
    }
    this.clients.clear();

    // Close page
    if (this.page) {
      try { await this.page.close(); } catch (e) {}
      this.page = null;
    }

    console.log(`[CC-CCTV] 🔒 Session destroyed: ${this.deviceName} ch${this.channel}`);
  }
}

module.exports = CarCentroCCTVService;
