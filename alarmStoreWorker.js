const { getAlarmTypeName, getAlarmCategory } = require("./alarmTypes");
const { fetchAlarmFiles } = require("./utils");
const ADAS = require("./models/adas");
const DSM = require("./models/dsm");

class AlarmStoreWorker {
  constructor(axiosInstance, token, organizeId) {
    this.axios = axiosInstance;
    this.token = token;
    this.organizeId = organizeId;
    this.queue = [];
    this.isProcessing = false;
  }

  addAlarms(alarms) {
    let added = 0;

    for (const alarm of alarms) {
      const category = getAlarmCategory(alarm.platform_alarm_id);

      if (category !== "ADAS" && category !== "DSM") continue;

      const safetyInfo = alarm.additional?.safety_info;
      const alarmKey = safetyInfo?.alarm_key || null;

      this.queue.push({
        alarm,
        category,
        alarmType: getAlarmTypeName(alarm.platform_alarm_id),
        speed: alarm.additional?.speed || 0,
        alarmKey,
      });
      added++;
    }

    if (added > 0) {
      console.log(`💾 AlarmStoreWorker: ${added} ADAS/DSM alarm masuk queue DB`);
      if (!this.isProcessing) {
        this.processQueue().catch((err) => {
          console.error("✗ Error di AlarmStoreWorker:", err.message);
          this.isProcessing = false;
        });
      }
    }
  }

  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    console.log("🔄 AlarmStoreWorker started");

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      const { alarm, category, alarmType, speed, alarmKey } = item;

      let files = [];
      try {
        if (alarmKey) {
          files = await fetchAlarmFiles(this.axios, this.token, this.organizeId, alarmKey, 5, 120000);
        }
      } catch (err) {
        console.error(`✗ AlarmStoreWorker: gagal fetch files untuk ${alarm.vehicle_name}:`, err.message);
      }

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

      try {
        let result;
        if (category === "ADAS") {
          result = await ADAS.findOneAndUpdate({ alarm_key: alarmKey }, baseDoc, { upsert: true, new: true });
        } else if (category === "DSM") {
          result = await DSM.findOneAndUpdate({ alarm_key: alarmKey }, baseDoc, { upsert: true, new: true });
        }

        console.log(`✅ ${category}: ${alarm.vehicle_name} - ${alarmType} @ ${baseDoc.event_time.toISOString()}`);
      } catch (err) {
        if (err.code !== 11000) {
          console.error(`✗ ${alarm.vehicle_name}:`, err.message);
        }
      }
    }

    this.isProcessing = false;
    console.log("✅ AlarmStoreWorker finished");
  }
}

module.exports = AlarmStoreWorker;
