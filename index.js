// index.js

const puppeteer = require("puppeteer");
const axios = require("axios");
const config = require("./config");
const LoginManager = require("./login");
const AlarmFileQueue = require("./queue");
// const WhatsAppService = require("./whatsapp"); // <-- NONAKTIF sementara
const { sleep, isLoggedIn, interceptAuthData } = require("./utils");
const mongoose = require("mongoose");
const express = require("express");
const app = express();
const Alert = require("./models/alert"); // Import model alert
const AlarmStoreWorker = require("./alarmStoreWorker");

// Endpoint simple untuk lihat Alert (bukan ADAS/DSM)
app.get("/api/alerts", async (req, res) => {
  try {
    const alerts = await Alert.find().sort({ timestamp: -1 }).limit(10);
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch alerts" });
  }
});

// NOTE: kamu belum pernah app.listen di sini, tapi biarkan dulu saja
// app.listen(3000, () => console.log("Express listening on 3000"));

// Koneksi ke MongoDB
mongoose
  .connect("mongodb://root:example@mongo:27017/alertsDB?authSource=admin", {
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

  console.log(
    `⏰ Tunggu ${waitSec}s sampai ${nextTime.toLocaleTimeString(
      "id-ID"
    )} untuk cycle berikutnya...`
  );
  await sleep(waitMs);
}

// Helper untuk format waktu ke format API
function formatTime(date) {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}+07:00`;
}

async function main() {
  let browser;
  let page;
  let token;
  let organizeId;

  // WhatsApp DINONAKTIFKAN dulu
  const whatsappService = null; // new WhatsAppService();

  // Global queue (masih dipakai untuk status / logging & file, tapi WA off)
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
    await page.goto(config.target.url, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

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

    // Queue lama (untuk fetch file & log). WA sudah dimatikan via whatsappService = null
    globalQueue = new AlarmFileQueue(
      axios,
      token,
      organizeId,
      whatsappService,
      5,
      300000
    );

    // Worker untuk simpan ADAS & DSM
    const alarmStoreWorker = new AlarmStoreWorker(axios, token, organizeId);

    // Helper: fetch semua alarm dalam range waktu, pakai pagination
    async function fetchAndProcessRange(startTime, endTime, options = {}) {
      const { includeQueue = true, pageLimit = 200 } = options;

      let pageNo = 1;
      let fetchedTotal = 0;

      console.log(
        `📡 Fetching safety alarms range ${formatTime(
          startTime
        )} -> ${formatTime(endTime)}`
      );

      while (true) {
        const requestData = {
          page: pageNo,
          limit: pageLimit,
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
          "sec-ch-ua":
            '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
        };

        console.log(`   → Request page ${pageNo}, limit ${pageLimit}`);

        const response = await axios.post(
          "https://ds.tgtrack.com/api/jtt808/alarm/safety",
          requestData,
          { headers }
        );
        const safetyData = response.data;

        const rows = safetyData.result?.rows || [];
        const total = safetyData.result?.total || 0;

        console.log(
          `   ✓ Page ${pageNo}: rows=${rows.length}, total=${total}`
        );

        if (!rows.length) {
          break;
        }

        fetchedTotal += rows.length;

        // Kirim ke worker simpan DB
        alarmStoreWorker.addAlarms(rows);

        // Untuk realtime saja, kita kirim ke globalQueue
        if (includeQueue && globalQueue) {
          const added = globalQueue.addAlarms(rows);
          if (added > 0 && !globalQueue.isProcessing) {
            globalQueue.startBackgroundWorker();
          }
        }

        // Kalau semua sudah ketarik, stop
        if (fetchedTotal >= total) {
          break;
        }

        pageNo++;
      }

      console.log(
        `📦 Selesai fetch range. Total rows diproses: ${fetchedTotal}\n`
      );
    }

    let cycleCount = 0;
    let firstCycle = true; // ← cycle pertama: fetch 3 hari ke belakang

    while (true) {
      cycleCount++;
      const now = new Date();

      console.log("\n" + "=".repeat(60));
      console.log(
        `🔄 CYCLE #${cycleCount} - ${now.toLocaleString("id-ID", {
          timeZone: "Asia/Jakarta",
        })}`
      );
      console.log("=".repeat(60) + "\n");

      if (cycleCount > 1 && globalQueue) {
        globalQueue.printStatus();
        console.log("");
      }

      try {
        const endTime = new Date();
        let startTime;

        if (firstCycle) {
          // CYCLE PERTAMA → ambil 3 hari penuh
          const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
          startTime = new Date(endTime.getTime() - THREE_DAYS_MS);
          console.log("🕒 MODE HISTORY: 3 hari ke belakang");
          await fetchAndProcessRange(startTime, endTime, {
            includeQueue: false, // history: tidak perlu WhatsApp/file queue
            pageLimit: 200,
          });
          firstCycle = false;
        } else {
          // CYCLE BERIKUTNYA → realtime 60 detik terakhir
          startTime = new Date(endTime.getTime() - 60000);
          console.log("🕒 MODE REALTIME: 60 detik terakhir");
          await fetchAndProcessRange(startTime, endTime, {
            includeQueue: true, // realtime boleh tetap pakai queue (tanpa WA)
            pageLimit: 50,
          });
        }
      } catch (error) {
        console.error("✗ Error dalam cycle:", error.message);

        if (error.message.includes("401") || error.message.includes("token")) {
          console.log("⚠ Mencoba re-intercept token...");
          const authData = await interceptAuthData(page);
          token = authData.token;
          organizeId = authData.organizeId || "61a22a23e0584dac";

          if (globalQueue) {
            globalQueue.token = token;
            globalQueue.organizeId = organizeId;
          }
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
