require("dotenv").config();
const axios = require("axios");
const Alert = require('./models/alert');  // Import model Alert
const ADAS = require('./models/adas');  // Import ADAS model
const DSM = require('./models/dsm');    // Import DSM model

class WhatsAppService {
  constructor() {
    // Ambil konfigurasi dari .env
    this.apiUrl = process.env.WHATSAPP_API_URL;
    this.username = process.env.WHATSAPP_USERNAME;
    this.password = process.env.WHATSAPP_PASSWORD;
    this.phoneNumber = process.env.WHATSAPP_PHONE_NUMBER;

    // Validasi konfigurasi
    if (!this.apiUrl || !this.username || !this.password || !this.phoneNumber) {
      throw new Error("WhatsApp configuration incomplete. Check your .env file.");
    }

    console.log("✓ WhatsApp service initialized");

    // Antrian pesan WhatsApp
    this.messageQueue = [];
    this.isProcessing = false;
  }

  // Fungsi untuk delay acak antara 5-10 detik
  getRandomDelay() {
    return Math.floor(Math.random() * (10000 - 5000 + 1)) + 5000;
  }

  // Helper untuk delay
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Kirim pesan WhatsApp langsung dengan Basic Auth
  async sendMessageDirect(phoneNumber, message) {
    try {
      const formattedPhone = phoneNumber.includes("@") ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
      const response = await axios.post(
        `${this.apiUrl}send/message`,
        {
          phone: formattedPhone,
          message: message,
        },
        {
          auth: {
            username: this.username,
            password: this.password,
          },
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error("✗ WhatsApp send message error:", error.message);
      if (error.response) {
        console.error("✗ Response status:", error.response.status);
        console.error("✗ Response body:", error.response.data);
      }
      return null;
    }
  }

  // Format pesan alarm DSM
  formatDSMAlarmMessage(alarm, alarmType, speed, files) {
    const eventTime = new Date(alarm.event_time).toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    // ✅ Filter file .bin (file_type === 3) agar tidak terkirim
    const filteredFiles = files.filter((file) => file.file_type !== 3);

    let message = `*PERINGATAN ALARM DSM*\n`;
    message += `=========================\n\n`;
    message += `Bus: ${alarm.vehicle_name}\n`;
    message += `Plat: ${alarm.lpn}\n`;
    message += `Jenis Alarm: ${alarmType}\n`;
    message += `Kecepatan: ${speed} km/h\n`;
    message += `Waktu: ${eventTime}\n`;
    message += `Lokasi: ${alarm.lat}, ${alarm.lng}\n\n`;

    message += `File Evidence (${filteredFiles.length}):\n`;
    message += `--------------------------\n`;

    filteredFiles.forEach((file, idx) => {
      let fileType = "File";
      if (file.file_type === 0) fileType = "Image";
      else if (file.file_type === 2) fileType = "Video";

      message += `${idx + 1}. ${fileType}: ${file.file_name}\n`;
      message += `   ${file.relative_path}\n\n`;
    });

    message += `Mohon tindak lanjut segera.`;

    return message;
  }

  // Tambahkan ke antrian pesan WhatsApp (queue)
  addToQueue(alarm, alarmType, speed, files) {
    const message = this.formatDSMAlarmMessage(alarm, alarmType, speed, files);

    // Cek duplikasi berdasarkan alarm ID
    const isDuplicate = this.messageQueue.some((item) => item.alarmId === alarm.id);

    if (!isDuplicate) {
      this.messageQueue.push({
        alarmId: alarm.id,
        vehicleName: alarm.vehicle_name,
        phoneNumber: this.phoneNumber,
        message: message,
        addedAt: Date.now(),
      });

      console.log(`📥 WhatsApp queue: ${alarm.vehicle_name} ditambahkan (Queue size: ${this.messageQueue.length})`);

      // Mulai worker jika belum berjalan
      if (!this.isProcessing) {
        this.startQueueWorker();
      }
    } else {
      console.log(`⏭️ WhatsApp queue: ${alarm.vehicle_name} sudah ada di queue, skip`);
    }
  }

  // Worker untuk memproses antrian pesan WhatsApp dengan delay acak
  async processQueue() {
    if (this.isProcessing) {
      console.log("⚠ WhatsApp queue worker sudah berjalan");
      return;
    }

    this.isProcessing = true;
    console.log("📤 WhatsApp queue worker started\n");

    while (this.messageQueue.length > 0) {
      const item = this.messageQueue.shift();

      console.log(`📱 Mengirim WhatsApp untuk ${item.vehicleName}...`);

      const result = await this.sendMessageDirect(item.phoneNumber, item.message);

      // Simpan alert ke MongoDB setelah mengirim pesan
      const alert = new Alert({
        vehicleName: item.vehicleName,
        alertType: item.message, // Sesuaikan jika perlu
        speed: item.message.split("Kecepatan: ")[1].split(" km/h")[0],  // Extract speed
      });

      await alert.save()
        .then(() => {
          console.log("Alert saved to MongoDB");
        })
        .catch((err) => console.error("Error saving alert to MongoDB:", err));

      if (result) {
        console.log(`✅ WhatsApp terkirim ke ${item.phoneNumber} - ${item.vehicleName}`);
      } else {
        console.log(`✗ WhatsApp gagal terkirim - ${item.vehicleName}`);
      }

      // Delay acak 5-10 detik sebelum mengirim pesan berikutnya
      if (this.messageQueue.length > 0) {
        const delay = this.getRandomDelay();
        const delaySec = Math.floor(delay / 1000);
        console.log(`⏳ Delay ${delaySec}s sebelum kirim pesan berikutnya... (Queue remaining: ${this.messageQueue.length})\n`);
        await this.sleep(delay);
      }
    }

    this.isProcessing = false;
    console.log("✅ WhatsApp queue worker finished (all messages sent)\n");
  }

  // Mulai worker untuk memproses antrian pesan WhatsApp
  startQueueWorker() {
    if (this.messageQueue.length === 0) {
      console.log("ℹ️ WhatsApp queue kosong, skip worker\n");
      return;
    }

    // Jalankan di background tanpa menunggu (non-blocking)
    this.processQueue().catch((err) => {
      console.error("✗ Error di WhatsApp queue worker:", err.message);
      this.isProcessing = false;
    });
  }

  // Dapatkan status antrian WhatsApp
  getQueueStatus() {
    return {
      queueLength: this.messageQueue.length,
      isProcessing: this.isProcessing,
    };
  }

  // Kirim notifikasi DSM alarm (tambahkan ke antrian)
  async sendDSMAlarmNotification(alarm, alarmType, speed, files) {
    this.addToQueue(alarm, alarmType, speed, files);
  }
}

module.exports = WhatsAppService;
