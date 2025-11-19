const { getAlarmTypeName, getAlarmCategory } = require("./alarmTypes");
const { fetchAlarmFiles, sleep } = require("./utils");
const ADAS = require("./models/adas");
const DSM = require("./models/dsm");

class AlarmStoreWorker {
  constructor(axiosInstance, token, organizeId, maxConcurrent = 100) {
    this.axios = axiosInstance;
    this.token = token;
    this.organizeId = organizeId;
    this.maxConcurrent = maxConcurrent; // ✅ Max 100 alarm parallel
    this.processing = new Map();
    this.queue = [];
  }

  addAlarms(alarms) {
    let added = 0;

    for (const alarm of alarms) {
      const category = getAlarmCategory(alarm.platform_alarm_id);

      if (category !== "ADAS" && category !== "DSM") continue;

      const safetyInfo = alarm.additional?.safety_info;
      const alarmKey = safetyInfo?.alarm_key || null;

      if (!alarmKey) continue;

      // Skip kalau udah diproses atau sedang diproses
      if (this.processing.has(alarmKey) || this.queue.some((item) => item.alarmKey === alarmKey)) {
        continue;
      }

      this.queue.push({
        alarm,
        category,
        alarmKey,
        queuedAt: Date.now(),
      });
      added++;
    }

    if (added > 0) {
      console.log(
        `💾 AlarmStoreWorker: +${added} alarm | Queue: ${this.queue.length} | Processing: ${this.processing.size}/${this.maxConcurrent}`
      );

      this.processQueue();
    }

    return added;
  }

  async processQueue() {
    // Process alarm dari queue selama ada slot available
    while (this.queue.length > 0 && this.processing.size < this.maxConcurrent) {
      const item = this.queue.shift();

      // Process alarm (non-blocking)
      this.processAlarm(item.alarm, item.category, item.alarmKey, item.queuedAt);

      // Small delay (50ms) biar gak overwhelm API
      await sleep(50);
    }
  }

  async processAlarm(alarm, category, alarmKey, queuedAt) {
    this.processing.set(alarmKey, Date.now());

    const alarmType = getAlarmTypeName(alarm.platform_alarm_id);
    const speed = alarm.additional?.location?.speed || 0;
    const startTime = Date.now();
    const waitTime = ((startTime - queuedAt) / 1000).toFixed(1);

    console.log(`📁 [${category}] ${alarm.vehicle_name} - ${alarmType} (queue wait: ${waitTime}s)`);

    try {
      const files = await fetchAlarmFiles(this.axios, this.token, this.organizeId, alarmKey, 5, 120000);

      const baseDoc = {
        vehicle_name: alarm.vehicle_name,
        lpn: alarm.lpn,
        alarm_type: alarmType,
        speed: speed,
        event_time: new Date(alarm.event_time),
        lat: alarm.lat,
        lng: alarm.lng,
        alarm_key: alarmKey,
        platform_alarm_id: alarm.platform_alarm_id,
        files: (files || []).map((f) => ({
          file_name: f.file_name,
          file_type: f.file_type,
          file_size: f.file_size,
          relative_path: f.relative_path,
        })),
      };

      const Model = category === "ADAS" ? ADAS : DSM;

      await Model.findOneAndUpdate({ alarm_key: alarmKey }, baseDoc, { upsert: true, new: true });

      const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(
        `✅ ${category} ${alarm.vehicle_name} @ ${speed} km/h - ${files.length} files (${processingTime}s) | Active: ${this.processing.size}/${this.maxConcurrent}`
      );
    } catch (err) {
      if (err.code === 11000) {
        console.log(`⏭️ Duplicate: ${alarmKey}`);
      } else {
        console.error(`✗ ${alarm.vehicle_name}: ${err.message}`);
      }
    } finally {
      this.processing.delete(alarmKey);

      // Process next dari queue
      if (this.queue.length > 0 && this.processing.size < this.maxConcurrent) {
        this.processQueue();
      }
    }
  }

  getStatus() {
    return {
      queue: this.queue.length,
      processing: this.processing.size,
      maxConcurrent: this.maxConcurrent,
      processingKeys: Array.from(this.processing.keys()).slice(0, 5), // First 5 keys
    };
  }

  printStatus() {
    const status = this.getStatus();
    console.log(`\n📊 AlarmStoreWorker Status:`);
    console.log(`   Queue: ${status.queue} waiting`);
    console.log(`   Processing: ${status.processing}/${status.maxConcurrent} active`);
    if (status.processingKeys.length > 0) {
      console.log(`   Sample keys: ${status.processingKeys.join(", ")}...`);
    }
  }
}

module.exports = AlarmStoreWorker;
