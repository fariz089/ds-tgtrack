// config.js

require("dotenv").config();
const path = require("path");

module.exports = {
  login: {
    url: process.env.TGTRACK_URL,
    username: process.env.TGTRACK_USERNAME,
    password: process.env.TGTRACK_PASSWORD,
  },

  captcha: {
    apiKey: process.env.CAPTCHA_API_KEY,
  },

  target: {
    url: process.env.MONITOR_URL,
    timeout: parseInt(process.env.MONITOR_TIMEOUT) || 30000,
  },

  // 🔥 FIX Puppeteer untuk Playwright Chromium (Docker compatible)
  browser: {
    headless: true,

    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,

    defaultViewport: null,

    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-breakpad",
      "--disable-component-extensions-with-background-pages",
      "--disable-ipc-flooding-protection",
      "--disable-renderer-backgrounding",
      "--disable-hang-monitor",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-popup-blocking",
      "--disable-sync",
      "--mute-audio",
      `--user-data-dir=${path.join(__dirname, "chrome-session")}`,
    ],
  },

  whatsapp: {
    phoneNumber: process.env.WHATSAPP_PHONE_NUMBER,
  },

  mongo: process.env.MONGO_URI,

  googleMaps: {
    apiKey: process.env.GOOGLE_MAPS_API_KEY || "YOUR_API_KEY_HERE",
  },

  oneWeekHistory: process.env.ONE_WEEK_HISTORY,
};
