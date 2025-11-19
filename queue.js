// queue.js
const { sleep } = require("./utils");
const { getAlarmTypeName, getAlarmCategory, getAlarmIcon } = require("./alarmTypes");
const { broadcastDSM, broadcastToCopilot } = require("./ws-server");

class AlarmFileQueue {
  constructor(axios, token, organizeId, whatsappService, targetFileCount = 5, maxWaitTime = 300000) {
    this.axios = axios;
    this.token = token;
    this.organizeId = organizeId;
    this.whatsappService = whatsappService;
    this.targetFileCount = targetFileCount;
    this.maxWaitTime = maxWaitTime;
    this.queue = [];
    this.completed = [];
    this.failed = [];
    this.isProcessing = false;
  }

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
          const alarmTypeName = getAlarmTypeName(alarm.platform_alarm_id);
          const alarmCategory = getAlarmCategory(alarm.platform_alarm_id);
          const alarmIcon = getAlarmIcon(alarm.platform_alarm_id);
          const speed = alarm.additional?.location?.speed || 0;

          this.queue.push({
            alarm,
            alarmKey,
            alarmType: alarmTypeName,
            alarmCategory,
            alarmIcon,
            speed,
            status: "menunggu",
            queuedAt: Date.now(),
            fileCount: 0,
          });

          // ✅ Instant broadcast ke WebSocket (tanpa file)
          try {
            broadcastToCopilot(alarm, alarmTypeName, alarmCategory, speed);
            console.log(`📡 WebSocket broadcast: ${alarm.vehicle_name} - ${alarmTypeName}`);
          } catch (error) {
            console.error("Broadcast error:", error.message);
          }

          // Broadcast DSM khusus
          if (alarmCategory === "DSM") {
            try {
              broadcastDSM(alarm, alarmTypeName, speed);
            } catch (error) {
              console.error("DSM broadcast error:", error.message);
            }
          }

          added++;
        }
      }
    });

    if (added > 0) {
      console.log(`📲 WhatsApp Queue: ${added} alarm masuk (total: ${this.queue.length})`);

      if (!this.isProcessing) {
        this.processQueue();
      }
    }

    return added;
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue[0];

      try {
        const waitTime = Date.now() - item.queuedAt;

        if (item.fileCount >= this.targetFileCount || waitTime >= this.maxWaitTime) {
          this.queue.shift();
          await this.sendNotifications(item);
        } else {
          await this.fetchFiles(item);
          await sleep(2000);
        }
      } catch (error) {
        console.error("Error processing queue item:", error);
        this.queue.shift();
        item.status = "gagal";
        item.errorMessage = error.message;
        this.failed.push(item);
      }
    }

    this.isProcessing = false;
  }

  async fetchFiles(item) {
    try {
      const requestData = {
        alarm_key: item.alarmKey,
      };

      const headers = {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        OrganizeId: this.organizeId,
      };

      const response = await this.axios.post("https://ds.tgtrack.com/api/open/alarm/file", requestData, { headers });

      if (response.data.code === 0 && response.data.result) {
        const files = response.data.result;
        item.files = files;
        item.fileCount = files.length;

        if (files.length >= this.targetFileCount) {
          console.log(`📦 ${item.alarm.vehicle_name}: ${files.length} files ready`);
        }
      }
    } catch (error) {
      // Silent fail - gak masalah
    }
  }

  async sendNotifications(item) {
    try {
      const whatsappEnabled = process.env.WHATSAPP_ENABLED === "true";

      if (this.whatsappService && whatsappEnabled) {
        const result = await this.whatsappService.sendAlarmNotification(
          item.alarm,
          item.alarmType,
          item.alarmCategory,
          item.files || [],
          item.speed
        );

        if (result.success) {
          item.status = "Terkirim";
          this.completed.push(item);

          const speed = item.speed ? ` @ ${item.speed} km/h` : "";
          const fileCount = item.fileCount || 0;
          const processingTime = ((Date.now() - item.queuedAt) / 1000).toFixed(0);

          console.log(
            `✅ WhatsApp: ${item.alarm.vehicle_name}${speed} - ${item.alarmType} (${fileCount} files, ${processingTime}s)`
          );
        } else {
          item.status = "gagal";
          item.errorMessage = result.error;
          this.failed.push(item);
          console.error(`❌ WhatsApp failed: ${result.error}`);
        }
      } else {
        item.status = "WhatsApp disabled";
        this.completed.push(item);
        console.log(`⏭️ ${item.alarm.vehicle_name} - WhatsApp disabled`);
      }
    } catch (error) {
      console.error("Error sending WhatsApp:", error);
      item.status = "gagal";
      item.errorMessage = error.message;
      this.failed.push(item);
    }
  }

  getStatus() {
    return {
      queueLength: this.queue.length,
      completed: this.completed.length,
      failed: this.failed.length,
      isProcessing: this.isProcessing,
    };
  }

  printStatus() {
    const status = this.getStatus();
    console.log(
      `📊 WhatsApp Queue Status: Queue=${status.queueLength}, Completed=${status.completed}, Failed=${status.failed}`
    );
  }

  clearCompleted() {
    const count = this.completed.length;
    this.completed = [];
    console.log(`🗑️ Cleared ${count} completed WhatsApp items`);
    return count;
  }

  clearFailed() {
    const count = this.failed.length;
    this.failed = [];
    console.log(`🗑️ Cleared ${count} failed WhatsApp items`);
    return count;
  }
}

module.exports = AlarmFileQueue;
