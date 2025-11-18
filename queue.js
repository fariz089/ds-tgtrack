// queue.js

const { sleep } = require("./utils");
const { getAlarmTypeName, getAlarmCategory, getAlarmIcon } = require("./alarmTypes");
const { broadcastDSM } = require('./ws-server');

class AlarmFileQueue {
  constructor(axios, token, organizeId, whatsappService, targetFileCount = 5, maxWaitTime = 300000) {
    this.axios = axios;
    this.token = token;
    this.organizeId = organizeId;
    this.whatsappService = whatsappService; // WhatsApp service instance
    this.targetFileCount = targetFileCount;
    this.maxWaitTime = maxWaitTime;
    this.queue = [];
    this.completed = [];
    this.failed = [];
    this.isProcessing = false;
  }

  // Tambahkan alarm ke queue
  addAlarms(alarms) {
    let added = 0;
    alarms.forEach((alarm) => {
      const alarmKey = alarm.additional?.safety_info?.alarm_key;
      if (alarmKey) {
        const isDuplicate =
          this.queue.some((item) => item.alarmKey === alarmKey) ||
          this.completed.some((item) => item.alarmKey === alarmKey) ||
          this.failed.some((item) => item.alarmKey === alarmKey);

        if (!isDuplicate) {
          const alarmType = getAlarmTypeName(alarm.platform_alarm_id);
          const alarmCategory = getAlarmCategory(alarm.platform_alarm_id);
          const alarmIcon = getAlarmIcon(alarm.platform_alarm_id);
          const speed = alarm.additional?.speed || 0;

          this.queue.push({
            alarm,
            alarmKey,
            alarmType,
            alarmCategory,
            alarmIcon,
            speed,
            retryCount: 0,
            lastFileCount: 0,
            startTime: Date.now(),
            files: [],
          });
          console.log(`➕ ${alarmIcon} ${alarm.vehicle_name} - ${alarmType} @ ${speed} km/h`);
          added++;
        } else {
          console.log(`⏭️ Skip duplikat: ${alarm.vehicle_name}`);
        }
      } else {
        console.log(`⚠ Skip ${alarm.vehicle_name} - Tidak ada alarm_key`);
      }
    });

    if (added > 0) {
      console.log(`\n📊 Total queue: ${this.queue.length} alarm(s) | Added: ${added}\n`);
    }

    return added;
  }

  // Fetch file untuk 1 alarm (single attempt)
  async fetchFiles(item) {
    const headers = {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en",
      Authorization: `Bearer ${this.token}`,
      Connection: "keep-alive",
      DNT: "1",
      OrganizeId: this.organizeId,
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

    try {
      item.retryCount++;
      const timestamp = Date.now();
      const url = `https://ds.tgtrack.com/api/open/safety/alarm/file?organize_id=${this.organizeId}&alarm_key=${item.alarmKey}&_t=${timestamp}`;

      const response = await this.axios.get(url, { headers });

      if (response.data.code === 0 && response.data.result) {
        item.files = response.data.result;
        const fileCount = item.files.length;

        if (fileCount !== item.lastFileCount) {
          const elapsed = Math.floor((Date.now() - item.startTime) / 1000);
          console.log(
            `📦 ${item.alarmIcon} ${item.alarm.vehicle_name} @ ${item.speed} km/h - ${fileCount}/${this.targetFileCount} files (${elapsed}s)`
          );
          item.lastFileCount = fileCount;
        }

        if (fileCount >= this.targetFileCount) {
          return "complete";
        }
      } else if (item.retryCount === 1) {
        console.log(
          `⏳ ${item.alarmIcon} ${item.alarm.vehicle_name} @ ${item.speed} km/h - ${item.alarmType} - Menunggu file...`
        );
      }

      return "pending";
    } catch (error) {
      if (item.retryCount === 1) {
        console.error(`✗ ${item.alarmIcon} ${item.alarm.vehicle_name} - Error:`, error.message);
      }
      return "pending";
    }
  }

  // Send WhatsApp notification untuk DSM alarms
  async sendWhatsAppNotification(item) {
    if (item.alarmCategory === "DSM" && this.whatsappService) {
      try {
        await this.whatsappService.sendDSMAlarmNotification(item.alarm, item.alarmType, item.speed, item.files);
        if (item.alarmCategory === "DSM") {
  broadcastDSM(item.alarm, item.alarmType, item.speed);
}
      } catch (error) {
        console.error(`✗ WhatsApp notification error untuk ${item.alarm.vehicle_name}:`, error.message);
      }
    }
  }

  // Process queue dengan round-robin (background worker)
  async processQueue() {
    if (this.isProcessing) {
      console.log("⚠ Queue worker sudah berjalan, skip");
      return;
    }

    this.isProcessing = true;
    console.log("🔄 Queue worker started (background)\n");

    while (this.queue.length > 0) {
      const item = this.queue.shift();

      const elapsed = Date.now() - item.startTime;
      if (elapsed > this.maxWaitTime) {
        const timeoutSec = Math.floor(elapsed / 1000);
        console.log(
          `⏱️ ${item.alarmIcon} ${item.alarm.vehicle_name} - Timeout ${timeoutSec}s (${item.files.length} files)`
        );
        this.failed.push(item);
        continue;
      }

      const status = await this.fetchFiles(item);

      if (status === "complete") {
        const totalTime = Math.floor((Date.now() - item.startTime) / 1000);
        console.log(
          `✅ ${item.alarmIcon} ${item.alarm.vehicle_name} @ ${item.speed} km/h - ${item.alarmType} - Lengkap! (${item.files.length} files, ${totalTime}s)\n`
        );
        this.completed.push(item);

        // Send WhatsApp notification jika DSM alarm (non-blocking, masuk queue)
        await this.sendWhatsAppNotification(item);
      } else {
        this.queue.push(item);
      }

      await sleep(1000);
    }

    this.isProcessing = false;
    console.log("✅ Queue worker finished\n");
  }

  // Start background worker
  startBackgroundWorker() {
    if (this.queue.length === 0) {
      console.log("ℹ️ Queue kosong, skip worker\n");
      return;
    }

    this.processQueue().catch((err) => {
      console.error("✗ Error di queue worker:", err.message);
      this.isProcessing = false;
    });
  }

  // Get status
  getStatus() {
    return {
      queueLength: this.queue.length,
      completed: this.completed.length,
      failed: this.failed.length,
      isProcessing: this.isProcessing,
    };
  }

  // Print status
  printStatus() {
    const status = this.getStatus();
    console.log(
      `📊 Queue Status: ${status.queueLength} pending | ${status.completed} completed | ${status.failed} failed`
    );
  }

  // Print hasil detail
  printResults() {
    console.log("\n=== HASIL LENGKAP ===\n");

    this.completed.forEach((item, idx) => {
      const alarm = item.alarm;

      console.log(`${idx + 1}. ${item.alarmIcon} ${alarm.vehicle_name} (${alarm.lpn})`);
      console.log(`   Alarm Type: ${item.alarmType}`);
      console.log(`   Category: ${item.alarmCategory}`);
      console.log(`   Speed: ${item.speed} km/h`);
      console.log(`   Alarm ID: ${alarm.id}`);
      console.log(`   Event Time: ${new Date(alarm.event_time).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`);
      console.log(`   📁 Files (${item.files.length}):`);

      item.files.forEach((file, fileIdx) => {
        const fileType = file.file_type === 0 ? "🖼️" : file.file_type === 2 ? "🎥" : file.file_type === 3 ? "📄" : "❓";
        console.log(`      ${fileIdx + 1}. ${fileType} ${file.file_name} (${(file.file_size / 1024).toFixed(2)} KB)`);
        console.log(`         ${file.relative_path}`);
      });
      console.log("");
    });

    if (this.failed.length > 0) {
      console.log("⚠ ALARM YANG GAGAL/TIMEOUT:\n");
      this.failed.forEach((item, idx) => {
        console.log(
          `${idx + 1}. ${item.alarmIcon} ${item.alarm.vehicle_name} @ ${item.speed} km/h - ${item.alarmType} (${
            item.files.length
          } files)`
        );
      });
      console.log("");
    }
  }
}

module.exports = AlarmFileQueue;
