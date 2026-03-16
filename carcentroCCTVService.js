// carcentroCCTVService.js
// Live CCTV streaming from CarCentro via Puppeteer screen capture
//
// Flow:
//   1. Open CarCentro login page in Puppeteer
//   2. Fill username/password form fields, click Login button
//   3. Wait for redirect to dashboard
//   4. Navigate to Video tab, click on device
//   5. Capture canvas/video frames as JPEG screenshots
//   6. Stream as MJPEG to dashboard clients
//
// Login MUST happen via Puppeteer form fill (not axios) because
// CarCentro sets session cookies via client-side JavaScript,
// not server-side Set-Cookie headers.

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
   * Initialize — just validate config. Each CaptureSession logs in on-demand.
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
    console.log("[CC-CCTV] ✅ Ready (sessions will login on-demand via form fill)");
    return true;
  }

  /**
   * Start a CCTV capture session for a specific device
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
      password: this.config.password,
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
 * Opens its own Puppeteer page, logs in via form fill, navigates to device video, captures frames
 */
class CaptureSession {
  constructor({ browser, baseUrl, authToken, username, password, imei, channel, deviceName, deviceID, frameInterval }) {
    this.browser = browser;
    this.baseUrl = baseUrl;
    this.authToken = authToken;
    this.username = username;
    this.password = password;
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
   * Start: open page, login via form fill, navigate to Video tab, click device, start capturing
   *
   * WHY FORM FILL (not axios):
   * CarCentro's Login API does NOT return Set-Cookie headers.
   * Cookies (aooog_login, AoooG_GPS_System_Key, etc.) are set by their
   * client-side JavaScript after the login API call completes.
   * Only a real browser (Puppeteer) can execute that JS and receive the cookies.
   */
  async start() {
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1366, height: 768 });
    await this.page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
    );

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // ============================================================
    // STEP 1: Navigate to login page
    // ============================================================
    console.log(`[CC-CCTV] [${this.deviceName}] Step 1: Opening login page...`);
    await this.page.goto(this.baseUrl + "/login/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    // Wait for JS framework (EasyUI/jQuery) to render the login form
    await sleep(5000);

    console.log(`[CC-CCTV] [${this.deviceName}] Login page loaded. URL: ${this.page.url()}`);

    // Debug: log all inputs on the page so we know what we're working with
    const inputsDebug = await this.page.evaluate(() => {
      var inputs = document.querySelectorAll("input");
      var result = [];
      for (var i = 0; i < inputs.length; i++) {
        result.push({
          type: inputs[i].type || "(none)",
          name: inputs[i].name,
          id: inputs[i].id,
          placeholder: inputs[i].placeholder,
          visible: inputs[i].offsetParent !== null,
          w: inputs[i].offsetWidth,
        });
      }
      return result;
    });
    console.log(`[CC-CCTV] [${this.deviceName}] Inputs found: ${JSON.stringify(inputsDebug)}`);

    // ============================================================
    // STEP 2: Fill username field
    // ============================================================
    console.log(`[CC-CCTV] [${this.deviceName}] Step 2: Filling username...`);

    const usernameFilled = await this.fillInputField([
      'input[name="username"]',
      'input[name="userName"]',
      'input[name="user"]',
      'input[name="account"]',
      'input[name="Account"]',
      'input[name="loginName"]',
      'input[id="username"]',
      'input[id="userName"]',
      'input[id="user"]',
      'input[id="account"]',
      'input[id="loginName"]',
      'input[id="txtAccount"]',
      'input[id="txtUser"]',
      'input[placeholder*="user" i]',
      'input[placeholder*="account" i]',
      'input[placeholder*="nama" i]',
      'input[placeholder*="帳號" i]',
      'input[placeholder*="账号" i]',
    ], this.username, "username");

    // Fallback: if no specific selector matched, use first visible text input
    if (!usernameFilled) {
      console.log(`[CC-CCTV] [${this.deviceName}] Trying fallback: first visible text input...`);
      const fallback = await this.fillInputField([
        'input[type="text"]',
        'input:not([type])',
      ], this.username, "username-fallback");

      if (!fallback) {
        await this.saveDebugScreenshot("login-no-username");
        throw new Error("Could not find username input field on login page");
      }
    }

    // ============================================================
    // STEP 3: Fill password field
    // ============================================================
    console.log(`[CC-CCTV] [${this.deviceName}] Step 3: Filling password...`);

    const passwordFilled = await this.fillInputField([
      'input[type="password"]',
      'input[name="password"]',
      'input[name="Password"]',
      'input[name="pwd"]',
      'input[name="Pwd"]',
      'input[id="password"]',
      'input[id="Password"]',
      'input[id="pwd"]',
      'input[id="txtPassword"]',
      'input[id="txtPwd"]',
    ], this.password, "password");

    if (!passwordFilled) {
      await this.saveDebugScreenshot("login-no-password");
      throw new Error("Could not find password input field on login page");
    }

    // Small delay for framework reactivity
    await sleep(500);

    // ============================================================
    // STEP 4: Click Login button
    // ============================================================
    console.log(`[CC-CCTV] [${this.deviceName}] Step 4: Clicking Login button...`);

    const loginClicked = await this.page.evaluate(() => {
      // Strategy 1: Specific selectors for common login buttons
      var selectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        "a.easyui-linkbutton",
        ".l-btn",
        "a.l-btn",
        "#btnLogin",
        "#loginBtn",
        "#btn_login",
        ".login-btn",
        ".btn-login",
        "button.login",
      ];

      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el && el.offsetParent !== null) {
          el.click();
          return { ok: true, method: "selector", selector: selectors[i], text: el.textContent.trim().substring(0, 30) };
        }
      }

      // Strategy 2: Find button/link by login-related text content
      var all = document.querySelectorAll('button, a, span, input[type="button"], input[type="submit"], div.btn, .l-btn');
      var loginTexts = ["login", "log in", "sign in", "submit", "登入", "登录", "masuk"];
      for (var j = 0; j < all.length; j++) {
        var text = all[j].textContent.trim().toLowerCase();
        if (all[j].offsetParent !== null && all[j].offsetWidth > 20) {
          for (var k = 0; k < loginTexts.length; k++) {
            if (text.includes(loginTexts[k])) {
              all[j].click();
              return { ok: true, method: "text-match", match: loginTexts[k], text: all[j].textContent.trim().substring(0, 30), tag: all[j].tagName };
            }
          }
        }
      }

      // Strategy 3: Click first visible button as last resort
      var buttons = document.querySelectorAll("button, a.l-btn, a.easyui-linkbutton");
      for (var m = 0; m < buttons.length; m++) {
        if (buttons[m].offsetParent !== null && buttons[m].offsetWidth > 30) {
          buttons[m].click();
          return { ok: true, method: "first-visible-button", text: buttons[m].textContent.trim().substring(0, 30), tag: buttons[m].tagName };
        }
      }

      return { ok: false };
    });

    console.log(`[CC-CCTV] [${this.deviceName}] Login click result: ${JSON.stringify(loginClicked)}`);

    if (!loginClicked.ok) {
      // Final fallback: press Enter (most login forms respond to Enter key)
      console.log(`[CC-CCTV] [${this.deviceName}] No login button found, pressing Enter...`);
      await this.page.keyboard.press("Enter");
    }

    // ============================================================
    // STEP 5: Wait for redirect to dashboard (away from /login/)
    // ============================================================
    console.log(`[CC-CCTV] [${this.deviceName}] Step 5: Waiting for login redirect...`);

    const loginTimeout = 30000;
    const loginStart = Date.now();
    let loginSuccess = false;

    while (Date.now() - loginStart < loginTimeout) {
      await sleep(1500);
      const currentUrl = this.page.url();

      // Success: URL no longer contains /login
      if (!currentUrl.includes("/login")) {
        loginSuccess = true;
        console.log(`[CC-CCTV] [${this.deviceName}] ✅ Login OK! Redirected to: ${currentUrl}`);
        break;
      }

      // Check if page shows error messages
      const errorText = await this.page.evaluate(() => {
        var errEls = document.querySelectorAll('.error, .alert, .message, .messager-body, .validatebox-invalid, [class*="error"], [class*="alert"]');
        for (var i = 0; i < errEls.length; i++) {
          var text = errEls[i].textContent.trim();
          if (text && text.length > 2 && text.length < 200 && errEls[i].offsetParent !== null) {
            return text;
          }
        }
        return null;
      });

      if (errorText) {
        console.warn(`[CC-CCTV] [${this.deviceName}] Login error on page: "${errorText}"`);
      }
    }

    if (!loginSuccess) {
      const finalUrl = this.page.url();
      console.warn(`[CC-CCTV] [${this.deviceName}] ⚠️ Still on login page after ${loginTimeout/1000}s. URL: ${finalUrl}`);

      // Some SPAs don't change URL — check if dashboard elements appeared
      const pageState = await this.page.evaluate(() => {
        var dashElements = document.querySelectorAll(".tabs, .panel, .layout, .tree, .datagrid, #map, [class*='dashboard']");
        return {
          dashElementCount: dashElements.length,
          title: document.title,
          bodyLength: document.body ? document.body.innerText.length : 0,
        };
      });
      console.log(`[CC-CCTV] [${this.deviceName}] Page state: ${JSON.stringify(pageState)}`);

      if (pageState.dashElementCount > 0) {
        console.log(`[CC-CCTV] [${this.deviceName}] Dashboard elements detected — treating as login success`);
        loginSuccess = true;
      } else {
        await this.saveDebugScreenshot("login-stuck");
        // Don't throw — start capture anyway so user can see what's on screen
        console.warn(`[CC-CCTV] [${this.deviceName}] Proceeding despite possible login failure`);
      }
    }

    // Wait for portal to fully render after login redirect
    await sleep(8000);
    console.log(`[CC-CCTV] [${this.deviceName}] Portal URL: ${this.page.url()}`);

    // ============================================================
    // STEP 6: Click Video tab
    // ============================================================
    console.log(`[CC-CCTV] [${this.deviceName}] Step 6: Clicking Video tab...`);
    try {
      const clickedVideo = await this.page.evaluate(() => {
        // Strategy 1: Look in tab containers
        var tabs = document.querySelectorAll(".tabs-title, .tabs a, a[href], span.l-btn-text, .tabs li, .panel-title");
        for (var i = 0; i < tabs.length; i++) {
          var text = tabs[i].textContent.trim();
          if (text === "Video" && tabs[i].offsetParent !== null) {
            tabs[i].click();
            return "clicked:" + tabs[i].tagName + ":" + text;
          }
        }
        // Strategy 2: Broader search for any element with text "Video"
        var all = document.querySelectorAll("a, span, div, li, td");
        for (var j = 0; j < all.length; j++) {
          var t = all[j].textContent.trim();
          if (t === "Video" && all[j].offsetParent !== null && all[j].offsetWidth > 10) {
            all[j].click();
            return "clicked-broad:" + all[j].tagName + ":" + t;
          }
        }
        return "not-found";
      });
      console.log(`[CC-CCTV] [${this.deviceName}] Video tab: ${clickedVideo}`);
      await sleep(5000);
    } catch (err) {
      console.warn(`[CC-CCTV] [${this.deviceName}] Video tab click error: ${err.message}`);
    }

    // ============================================================
    // STEP 7: Find and click on the device
    // ============================================================
    console.log(`[CC-CCTV] [${this.deviceName}] Step 7: Looking for device...`);
    try {
      // Extract bus name (e.g., "TWEETY" from "N 7187 UG-TWEETY")
      const busName = this.deviceName.includes("-") ? this.deviceName.split("-").pop().trim() : this.deviceName;

      const clickedDevice = await this.page.evaluate((fullName, shortName) => {
        var elements = document.querySelectorAll("tr td, .tree-title, .datagrid-cell, span, div.tree-node");
        for (var i = 0; i < elements.length; i++) {
          var text = elements[i].textContent.trim();
          if ((text.includes(fullName) || text.includes(shortName)) && elements[i].offsetParent !== null) {
            // Double-click first (some CarCentro grids need dblclick to open video)
            elements[i].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
            elements[i].click();
            return text;
          }
        }
        return null;
      }, this.deviceName, busName);

      if (clickedDevice) {
        console.log(`[CC-CCTV] [${this.deviceName}] Clicked device: "${clickedDevice}"`);
      } else {
        console.warn(`[CC-CCTV] [${this.deviceName}] Device not found in video list`);
        await this.saveDebugScreenshot("device-not-found");
      }

      await sleep(8000); // Wait for video player to connect and render
    } catch (err) {
      console.warn(`[CC-CCTV] [${this.deviceName}] Device click error: ${err.message}`);
    }

    // ============================================================
    // STEP 8: Start frame capture loop
    // ============================================================
    this.isCapturing = true;
    this.captureLoop();

    console.log(`[CC-CCTV] [${this.deviceName}] ✅ Capture started (ch${this.channel})`);
  }

  /**
   * Helper: Fill an input field using multiple selector strategies
   * Uses native setter + event dispatch to work with reactive frameworks (jQuery, EasyUI, Vue, React)
   *
   * @param {string[]} selectors - CSS selectors to try in order
   * @param {string} value - Value to fill
   * @param {string} label - Label for logging
   * @returns {boolean} - Whether fill was successful
   */
  async fillInputField(selectors, value, label) {
    const result = await this.page.evaluate((selectorList, val) => {
      for (var i = 0; i < selectorList.length; i++) {
        var el = document.querySelector(selectorList[i]);
        if (el && el.offsetParent !== null) {
          // Clear existing value
          el.value = "";
          el.focus();

          // Use native HTMLInputElement.value setter to bypass framework getters/setters
          // This ensures React, Vue, jQuery etc. detect the change
          var nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, "value"
          ).set;
          nativeSetter.call(el, val);

          // Dispatch events that frameworks listen for
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("keyup", { bubbles: true }));

          return {
            ok: true,
            selector: selectorList[i],
            id: el.id,
            name: el.name,
            type: el.type,
          };
        }
      }
      return { ok: false };
    }, selectors, value);

    if (result.ok) {
      console.log(`[CC-CCTV] [${this.deviceName}] Filled ${label}: selector=${result.selector} id=${result.id} name=${result.name}`);
    } else {
      console.warn(`[CC-CCTV] [${this.deviceName}] Could not fill ${label}: none of ${selectors.length} selectors matched a visible input`);
    }

    return result.ok;
  }

  /**
   * Helper: Save a debug screenshot and log page info
   */
  async saveDebugScreenshot(tag) {
    try {
      const frame = await this.page.screenshot({ type: "jpeg", quality: 80 });
      this.lastFrame = frame;
      const title = await this.page.title();
      console.log(`[CC-CCTV] [${this.deviceName}] 📸 Debug screenshot saved (${tag}): ${frame.length} bytes, title="${title}"`);
    } catch (e) {
      console.warn(`[CC-CCTV] [${this.deviceName}] Could not save debug screenshot: ${e.message}`);
    }
  }

  /**
   * Capture loop — takes screenshots at regular intervals
   */
  async captureLoop() {
    if (!this.isCapturing || !this.page) return;

    try {
      let frame;

      // Try to screenshot just the video area for better quality
      const videoRect = await this.page.evaluate(() => {
        var selectors = [
          "canvas",
          ".dvr_player_box",
          ".dvr-player",
          '[class*="video"]',
          '[class*="player"]',
          ".panel-body",
        ];

        for (var i = 0; i < selectors.length; i++) {
          var el = document.querySelector(selectors[i]);
          if (el && el.offsetWidth > 100 && el.offsetHeight > 100) {
            var rect = el.getBoundingClientRect();
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
        // Full page screenshot fallback
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