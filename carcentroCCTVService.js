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
   * Initialize — login to CarCentro in Puppeteer
   */
  async init() {
    if (!this.browser) {
      console.error("[CC-CCTV] No browser instance");
      return false;
    }

    try {
      console.log("[CC-CCTV] Initializing...");

      this.portalPage = await this.browser.newPage();
      await this.portalPage.setViewport({ width: 1400, height: 900 });
      await this.portalPage.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
      );

      // Set login cookies before navigating
      await this.portalPage.setCookie(
        { name: "aooog_login", value: this.authToken, domain: new URL(this.baseUrl).hostname, path: "/" },
        { name: "aooog_cookie_lng", value: "en", domain: new URL(this.baseUrl).hostname, path: "/" },
        { name: "account_name", value: this.config.username, domain: new URL(this.baseUrl).hostname, path: "/" },
      );

      // Navigate to portal
      console.log("[CC-CCTV] Navigating to portal...");
      await this.portalPage.goto(this.baseUrl + "/#", {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      // Wait for login to complete (check for logged-in indicator)
      await this.portalPage.waitForTimeout(5000);

      // Check if we're on the main dashboard (not login page)
      const url = this.portalPage.url();
      if (url.includes("/login")) {
        console.error("[CC-CCTV] Still on login page, trying manual login...");
        // Try calling login API from page context
        await this.portalPage.evaluate(async (authToken, baseUrl) => {
          const params = new URLSearchParams({
            authentication: authToken,
            localTime: new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }),
            "domain[]": new URL(baseUrl).hostname,
            _: Date.now().toString(),
          });
          await fetch(`${baseUrl}/AoooG_WebService.svc/Login?${params}`, { credentials: "include" });
        }, this.authToken, this.baseUrl);

        // Navigate again
        await this.portalPage.goto(this.baseUrl + "/#", { waitUntil: "networkidle2", timeout: 30000 });
        await this.portalPage.waitForTimeout(3000);
      }

      this.isLoggedIn = true;
      this.isReady = true;
      console.log("[CC-CCTV] ✅ Portal loaded and logged in");
      return true;
    } catch (err) {
      console.error("[CC-CCTV] Init error:", err.message);
      return false;
    }
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

    // Set login cookies
    const domain = new URL(this.baseUrl).hostname;
    await this.page.setCookie(
      { name: "aooog_login", value: this.authToken, domain, path: "/" },
      { name: "aooog_cookie_lng", value: "en", domain, path: "/" },
      { name: "account_name", value: this.username, domain, path: "/" },
    );

    // Navigate to portal
    console.log(`[CC-CCTV] Navigating to portal for ${this.deviceName}...`);
    await this.page.goto(this.baseUrl + "/#", { waitUntil: "networkidle2", timeout: 60000 });
    await this.page.waitForTimeout(3000);

    // If redirected to login, do login from page context
    if (this.page.url().includes("/login")) {
      console.log("[CC-CCTV] On login page, performing login...");
      await this.page.evaluate(async (authToken, baseUrl) => {
        const params = new URLSearchParams({
          authentication: authToken,
          localTime: new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }),
          "domain[]": new URL(baseUrl).hostname,
          _: Date.now().toString(),
        });
        await fetch(`${baseUrl}/AoooG_WebService.svc/Login?${params}`, { credentials: "include" });
      }, this.authToken, this.baseUrl);

      await this.page.goto(this.baseUrl + "/#", { waitUntil: "networkidle2", timeout: 30000 });
      await this.page.waitForTimeout(3000);
    }

    console.log(`[CC-CCTV] Portal loaded. Clicking Video tab...`);

    // Click Video tab
    try {
      // The Video tab link from the portal HTML
      await this.page.evaluate(() => {
        const tabs = document.querySelectorAll("a, span, div");
        for (const el of tabs) {
          if (el.textContent.trim() === "Video" || el.textContent.trim().includes("Video")) {
            el.click();
            return true;
          }
        }
        return false;
      });
      await this.page.waitForTimeout(3000);
    } catch (err) {
      console.warn(`[CC-CCTV] Could not click Video tab: ${err.message}`);
    }

    console.log(`[CC-CCTV] Looking for device: ${this.deviceName} (ID: ${this.deviceID})...`);

    // Find and click on the device in the tree/list
    try {
      await this.page.evaluate((deviceName) => {
        // Search in tree nodes, table rows, etc.
        const allElements = document.querySelectorAll("*");
        for (const el of allElements) {
          const text = el.textContent.trim();
          // Match by device name (Alias like "N 7187 UG-TWEETY")
          if (text === deviceName || text.includes(deviceName.split("-").pop())) {
            if (el.offsetParent !== null) { // Visible element
              el.click();
              return true;
            }
          }
        }
        return false;
      }, this.deviceName);

      await this.page.waitForTimeout(5000); // Wait for video player to initialize
    } catch (err) {
      console.warn(`[CC-CCTV] Could not click device: ${err.message}`);
    }

    // Start frame capture loop
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
