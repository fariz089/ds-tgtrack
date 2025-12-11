const mongoose = require("mongoose");

const healthDataSchema = new mongoose.Schema(
  {
    // Current stats
    steps: { type: Number, required: true, default: 0 },
    heartRate: { type: Number, required: true, default: 0 },
    spo2: { type: Number, default: 0 },
    stress: { type: Number, default: 0 },
    distance: { type: Number, default: 0 },
    calories: { type: Number, default: 0 },
    vitality: { type: Number, default: 0 },

    // Daily aggregates
    dailySteps: [
      {
        date: String,
        steps: Number,
      },
    ],
    dailyCalories: [
      {
        date: String,
        calories: Number,
      },
    ],

    // Heart rate history
    heartRateHistory: [
      {
        time: String,
        heartRate: Number,
      },
    ],

    // Sleep data
    sleepData: [
      {
        date: String,
        deep: Number,
        light: Number,
        rem: Number,
        awake: Number,
      },
    ],

    // Stress history
    stressHistory: [
      {
        date: String,
        stress: Number,
      },
    ],

    // SpO2 history
    spo2History: [
      {
        date: String,
        spo2: Number,
      },
    ],

    // Activity breakdown
    activityBreakdown: {
      type: Map,
      of: Number,
    },

    // Metadata
    timestamp: { type: Number, required: true },
    dataHash: { type: String, required: true, unique: true, index: true },
    deviceId: { type: String, required: true, index: true },
    syncTime: { type: Date, default: Date.now },

    // Driver / User
    driverName: { type: String, required: true },

    // Timestamps
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: "health_data",
  }
);

// Index untuk query optimization
healthDataSchema.index({ deviceId: 1, timestamp: -1 });
healthDataSchema.index({ createdAt: -1 });
healthDataSchema.index({ dataHash: 1 }, { unique: true });

// Prevent duplicate data
healthDataSchema.pre("save", async function (next) {
  const exists = await this.constructor.findOne({
    dataHash: this.dataHash,
  });

  if (exists) {
    const err = new Error("Duplicate data detected");
    err.code = "DUPLICATE_DATA";
    return next(err);
  }

  next();
});

module.exports = mongoose.model("HealthData", healthDataSchema);
