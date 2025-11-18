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
  browser: {
    headless: process.env.BROWSER_HEADLESS === "true",
    defaultViewport: null,
    args: ["--start-maximized", `--user-data-dir=${path.join(__dirname, "chrome-session")}`],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
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
