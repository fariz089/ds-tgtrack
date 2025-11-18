// index.js

const puppeteer = require("puppeteer");
const axios = require("axios");
const config = require("./config");
const LoginManager = require("./login");
const AlarmFileQueue = require("./queue");
const WhatsAppService = require("./whatsapp");
const { sleep, isLoggedIn, interceptAuthData } = require("./utils");
const mongoose = require('mongoose');
const express = require('express');
const app = express();
const Alert = require('./models/alert');  // Import model alert

app.get('/api/alerts', async (req, res) => {
  try {
    const alerts = await Alert.find().sort({ timestamp: -1 }).limit(10);  // Ambil 10 alert terbaru
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch alerts' });
  }
});

// Koneksi ke MongoDB
mongoose.connect('mongodb://root:example@mongo:27017/alertsDB?authSource=admin', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Tunggu sampai detik kelipatan 15 berikutnya
async function waitUntilNext15Seconds() {
  const now = new Date();
  const currentSeconds = now.getSeconds();

  let targetSeconds;
  if (currentSeconds < 15) {
    targetSeconds = 15;
  } else if (currentSeconds < 30) {
    targetSeconds = 30;
  } else if (currentSeconds < 45) {
    targetSeconds = 45;
  } else {
    targetSeconds = 60;
  }

  const nextTime = new Date(now);
  if (targetSeconds === 60) {
    nextTime.setMinutes(now.getMinutes() + 1);
    nextTime.setSeconds(0);
  } else {
    nextTime.setSeconds(targetSeconds);
  }
  nextTime.setMilliseconds(0);

  const waitMs = nextTime - now;
  const waitSec = Math.floor(waitMs / 1000);

  console.log(`⏰ Tunggu ${waitSec}s sampai ${nextTime.toLocaleTimeString("id-ID")} untuk cycle berikutnya...`);
  await sleep(waitMs);
}

async function main() {
  let browser;
  let page;
  let token;
  let organizeId;

  // Initialize WhatsApp service
  const whatsappService = new WhatsAppService();

  // Global queue
  let globalQueue = null;

  try {
    console.log("🚀 Starting DS-TGTrack Monitor Service...\n");
    console.log("launching browser dengan persistent session...");
    browser = await puppeteer.launch(config.browser);
    page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on("request", (request) => {
      request.continue();
    });

    console.log("navigasi ke halaman...");
    await page.goto(config.target.url, { waitUntil: "networkidle2", timeout: 30000 });

    await sleep(2000);
    const alreadyLoggedIn = await isLoggedIn(page);

    if (alreadyLoggedIn) {
      console.log("✓ Sudah login dari session sebelumnya!");
    } else {
      console.log("Belum login, mulai proses login...");

      const loginManager = new LoginManager(config);
      const loginResult = await loginManager.login(page);

      if (!loginResult.success) {
        console.log("✗ Login gagal, url terakhir:", loginResult.url);
        return;
      }

      console.log("✓ Login berhasil!");
      await sleep(3000);
    }

    console.log("tunggu intercept token...");
    await sleep(2000);
    const authData = await interceptAuthData(page);
    token = authData.token;
    organizeId = authData.organizeId || "61a22a23e0584dac";

    console.log("✓ Token dan OrganizeId berhasil diambil\n");

    // Buat global queue dengan WhatsApp service
    globalQueue = new AlarmFileQueue(axios, token, organizeId, whatsappService, 5, 300000);

    let cycleCount = 0;

    while (true) {
      cycleCount++;
      const now = new Date();

      console.log("\n" + "=".repeat(60));
      console.log(`🔄 CYCLE #${cycleCount} - ${now.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`);
      console.log("=".repeat(60) + "\n");

      if (cycleCount > 1) {
        globalQueue.printStatus();
        console.log("");
      }

      try {
        console.log("📡 Fetching safety alarms untuk 15 detik terakhir...\n");

        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 60000);

        const formatTime = (date) => {
          const pad = (n) => n.toString().padStart(2, "0");
          return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
            date.getHours()
          )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}+07:00`;
        };

        const requestData = {
          page: 1,
          limit: 10,
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

        console.log("Request range:", formatTime(startTime), "to", formatTime(endTime));

        const response = await axios.post("https://ds.tgtrack.com/api/jtt808/alarm/safety", requestData, { headers });
        const safetyData = response.data;

        console.log(`✓ Response code: ${safetyData.code}`);
        console.log(`✓ Total alarms: ${safetyData.result?.total || 0}`);
        console.log(`✓ Rows returned: ${safetyData.result?.rows?.length || 0}\n`);

        if (safetyData.code === 0 && safetyData.result && safetyData.result.rows && safetyData.result.rows.length > 0) {
          const alarms = safetyData.result.rows;
          const added = globalQueue.addAlarms(alarms);

          if (added > 0 && !globalQueue.isProcessing) {
            globalQueue.startBackgroundWorker();
          }
        } else {
          console.log("ℹ️ Tidak ada alarm baru dalam 15 detik terakhir\n");
        }
      } catch (error) {
        console.error("✗ Error dalam cycle:", error.message);

        if (error.message.includes("401") || error.message.includes("token")) {
          console.log("⚠ Mencoba re-intercept token...");
          const authData = await interceptAuthData(page);
          token = authData.token;
          organizeId = authData.organizeId || "61a22a23e0584dac";

          globalQueue.token = token;
          globalQueue.organizeId = organizeId;
        }
      }

      await waitUntilNext15Seconds();
    }
  } catch (error) {
    console.error("✗ Fatal Error:", error.message);
    console.error(error.stack);
  } finally {
    if (browser) {
      await browser.close();
      console.log("browser ditutup");
    }
  }
}

main();
