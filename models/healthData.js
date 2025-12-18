const mongoose = require("mongoose");

const healthDataSchema = new mongoose.Schema(
  {
    // Field untuk unique constraint per hari
    date: {
      type: String,
      required: true,
      index: true,
    }, // Format: "YYYY-MM-DD"

    // Current stats (nilai terbaru)
    steps: {
      type: Number,
      required: true,
      default: 0,
    },
    heartRate: {
      type: Number,
      required: true,
      default: 0,
    },
    spo2: {
      type: Number,
      default: 0,
    },
    stress: {
      type: Number,
      default: 0,
    },
    distance: {
      type: Number,
      default: 0,
    },
    calories: {
      type: Number,
      default: 0,
    },
    vitality: {
      type: Number,
      default: 0,
    },

    // Daily aggregates
    dailySteps: [
      {
        date: String, // "YYYY-MM-DD"
        steps: Number,
      },
    ],
    dailyCalories: [
      {
        date: String, // "YYYY-MM-DD"
        calories: Number,
      },
    ],

    // Heart rate history - UBAH: time ke Date object
    heartRateHistory: [
      {
        time: {
          type: Date,
          required: true,
        }, // Full datetime dengan timezone
        heartRate: {
          type: Number,
          required: true,
        },
      },
    ],

    // Sleep data
    sleepData: [
      {
        date: String, // "YYYY-MM-DD"
        deep: Number,
        light: Number,
        rem: Number,
        awake: Number,
        startTime: Date, // Optional: waktu mulai tidur
        endTime: Date, // Optional: waktu bangun
      },
    ],

    // Stress history
    stressHistory: [
      {
        time: Date, // Full datetime
        stress: Number,
      },
    ],

    // SpO2 history - UBAH: tambah time untuk datetime lengkap
    spo2History: [
      {
        time: {
          type: Date,
          required: true,
        }, // Full datetime dengan timezone
        spo2: {
          type: Number,
          required: true,
        },
      },
    ],

    // Activity breakdown (map of activity types to durations)
    activityBreakdown: {
      type: Map,
      of: Number,
      default: {},
    },

    // Metadata
    timestamp: {
      type: Number,
      required: true,
      index: true,
    }, // Unix timestamp dari device

    dataHash: {
      type: String,
      required: true,
    }, // Hash untuk tracking, tapi tidak unique

    deviceId: {
      type: String,
      required: true,
      index: true,
    }, // ID device Mi Band

    syncTime: {
      type: Date,
      default: Date.now,
      index: true,
    }, // Waktu sync ke server

    // Driver / User info
    driverName: {
      type: String,
      required: true,
      index: true,
    },

    // Optional: Additional user info
    vehicleId: String,
    routeId: String,

    // Timestamps (auto-managed by Mongoose)
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true, // Auto-update createdAt dan updatedAt
    collection: "health_data",
  }
);

// ==========================================
// INDEXES
// ==========================================

// 1. COMPOUND UNIQUE INDEX - Prevent duplicate per driver per hari
healthDataSchema.index(
  {
    deviceId: 1,
    driverName: 1,
    date: 1,
  },
  {
    unique: true,
    name: "unique_driver_daily_data",
  }
);

// 2. Query optimization indexes
healthDataSchema.index({ deviceId: 1, timestamp: -1 });
healthDataSchema.index({ driverName: 1, date: -1 });
healthDataSchema.index({ createdAt: -1 });
healthDataSchema.index({ syncTime: -1 });

// 3. Index untuk filtering berdasarkan tanggal range
healthDataSchema.index({ date: 1, driverName: 1 });

// ==========================================
// VIRTUAL FIELDS (Optional)
// ==========================================

// Virtual untuk mendapatkan total heart rate readings
healthDataSchema.virtual("heartRateCount").get(function () {
  return this.heartRateHistory?.length || 0;
});

// Virtual untuk mendapatkan average heart rate
healthDataSchema.virtual("avgHeartRate").get(function () {
  if (!this.heartRateHistory || this.heartRateHistory.length === 0) {
    return 0;
  }
  const sum = this.heartRateHistory.reduce((acc, curr) => acc + curr.heartRate, 0);
  return Math.round(sum / this.heartRateHistory.length);
});

// Virtual untuk mendapatkan heart rate range (min/max)
healthDataSchema.virtual("heartRateRange").get(function () {
  if (!this.heartRateHistory || this.heartRateHistory.length === 0) {
    return { min: 0, max: 0 };
  }
  const rates = this.heartRateHistory.map((h) => h.heartRate);
  return {
    min: Math.min(...rates),
    max: Math.max(...rates),
  };
});

// Virtual untuk average SpO2
healthDataSchema.virtual("avgSpo2").get(function () {
  if (!this.spo2History || this.spo2History.length === 0) {
    return 0;
  }
  const sum = this.spo2History.reduce((acc, curr) => acc + curr.spo2, 0);
  return Math.round((sum / this.spo2History.length) * 10) / 10; // 1 decimal
});

// ==========================================
// METHODS
// ==========================================

// Method untuk mendapatkan data summary
healthDataSchema.methods.getSummary = function () {
  return {
    id: this._id,
    date: this.date,
    driverName: this.driverName,
    deviceId: this.deviceId,
    steps: this.steps,
    calories: this.calories,
    distance: this.distance,
    heartRate: {
      current: this.heartRate,
      average: this.avgHeartRate,
      min: this.heartRateRange.min,
      max: this.heartRateRange.max,
      readings: this.heartRateCount,
    },
    spo2: {
      current: this.spo2,
      average: this.avgSpo2,
      readings: this.spo2History?.length || 0,
    },
    stress: this.stress,
    vitality: this.vitality,
    lastSync: this.syncTime,
  };
};

// Static method untuk get data berdasarkan driver dan date range
healthDataSchema.statics.getDriverDataByDateRange = function (driverName, startDate, endDate) {
  return this.find({
    driverName: driverName,
    date: {
      $gte: startDate, // "YYYY-MM-DD"
      $lte: endDate, // "YYYY-MM-DD"
    },
  })
    .sort({ date: 1 })
    .lean();
};

// Static method untuk get latest data per driver
healthDataSchema.statics.getLatestByDriver = function (driverName) {
  return this.findOne({ driverName: driverName }).sort({ date: -1, syncTime: -1 }).lean();
};

// ==========================================
// MIDDLEWARE
// ==========================================

// Pre-save: Auto-set date dari timestamp jika belum ada
healthDataSchema.pre("save", function (next) {
  if (!this.date && this.timestamp) {
    const dateObj = new Date(this.timestamp);
    this.date = dateObj.toISOString().split("T")[0]; // "YYYY-MM-DD"
  }
  next();
});

// Pre-update: Update updatedAt
healthDataSchema.pre("findOneAndUpdate", function (next) {
  this.set({ updatedAt: new Date() });
  next();
});

// ==========================================
// OPTIONS
// ==========================================

// Enable virtuals in JSON
healthDataSchema.set("toJSON", {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret.__v;
    return ret;
  },
});

healthDataSchema.set("toObject", {
  virtuals: true,
});

// ==========================================
// EXPORT MODEL
// ==========================================

module.exports = mongoose.model("HealthData", healthDataSchema);
