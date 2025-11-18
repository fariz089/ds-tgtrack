// alarmStoreWorker.js

const { getAlarmTypeName, getAlarmCategory } = require("./alarmTypes");
const { fetchAlarmFiles } = require("./utils");
const ADAS = require("./models/adas");
const DSM = require("./models/dsm");

/**
 * Worker khusus untuk:
 *  - Menyimpan SEMUA alarm ADAS & DSM ke MongoDB
 *  - Menunggu file evidence sampai lengkap (via fetchAlarmFiles)
 *  - Mengkonversi event_time ke zona waktu Asia/Jakarta
 */
class AlarmStoreWorker {
  /**
   * @param {Object} axiosInstance - axios dari index.js
   * @param {string} token - Bearer token TGTrack
   * @param {string} organizeId - OrganizeId TGTrack
   */
  constructor(axiosInstance, token, organizeId) {
    this.axios = axiosInstance;
    this.token = token;
    this.organizeId = organizeId;

    this.queue = [];
    this.isProcessing = false;
  }

  // Dipanggil dari index.js setiap kali ada batch alarm baru
  addAlarms(alarms) {
    let added = 0;

    for (const alarm of alarms) {
      const category = getAlarmCategory(alarm.platform_alarm_id);

      // Kita hanya simpan ADAS & DSM
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

  // Konversi event_time (timestamp ms) ke Date dengan zona waktu Jakarta (+7)
  toJakartaDate(eventTimeMs) {
    const utcDate = new Date(eventTimeMs);
    // toLocaleString dengan timezone Asia/Jakarta → string → Date baru
    return new Date(
      utcDate.toLocaleString("en-US", { timeZone: "Asia/Jakarta" })
    );
  }

  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    console.log("🔄 AlarmStoreWorker started");

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      const { alarm, category, alarmType, speed, alarmKey } = item;

      // --- 1. Ambil daftar file dari API (nunggu sampai lengkap) ---
      let files = [];
      try {
        if (alarmKey) {
          files = await fetchAlarmFiles(
            this.axios,
            this.token,
            this.organizeId,
            alarmKey,
            5, // targetFileCount minimal 5 file
            120000 // maxWaitTime 120 detik
          );
        } else {
          console.log(
            `ℹ️ AlarmStoreWorker: ${alarm.vehicle_name} tidak punya alarm_key, skip fetch files`
          );
        }
      } catch (err) {
        console.error(
          `✗ AlarmStoreWorker: gagal fetch files untuk ${alarm.vehicle_name}:`,
          err.message
        );
      }

      // --- 2. Build dokumen untuk Mongo ---
      const baseDoc = {
        vehicle_name: alarm.vehicle_name,
        lpn: alarm.lpn,
        alarm_type: alarmType,
        speed: speed,
        event_time: this.toJakartaDate(alarm.event_time), // waktu Jakarta
        lat: alarm.lat,
        lng: alarm.lng,
        files: (files || []).map((f) => ({
          file_name: f.file_name,
          file_type: f.file_type,
          file_size: f.file_size,
          relative_path: f.relative_path,
        })),
      };

      try {
        if (category === "ADAS") {
          await ADAS.create(baseDoc);
        } else if (category === "DSM") {
          await DSM.create(baseDoc);
        }

        console.log(
          `✅ Simpan ${category} alarm ke DB: ${alarm.vehicle_name} - ${alarmType} (files: ${baseDoc.files.length})`
        );
      } catch (err) {
        console.error("✗ Error simpan alarm ke MongoDB:", err.message);
      }
    }

    this.isProcessing = false;
    console.log("✅ AlarmStoreWorker finished");
  }
}

module.exports = AlarmStoreWorker;
