const mongoose = require("mongoose");

const healthDataSchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: true,
      index: true,
    },

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

    dailySteps: [
      {
        date: String,
        steps: Number,
        _id: false,
      },
    ],
    dailyCalories: [
      {
        date: String,
        calories: Number,
        _id: false,
      },
    ],

    heartRateHistory: [
      {
        time: {
          type: String,
          required: true,
        },
        heartRate: {
          type: Number,
          required: true,
        },
        _id: false,
      },
    ],

    sleepData: [
      {
        date: String,
        deep: Number,
        light: Number,
        rem: Number,
        awake: Number,
        startTime: String,
        endTime: String,
        _id: false,
      },
    ],

    stressHistory: [
      {
        time: String,
        stress: Number,
        _id: false,
      },
    ],

    spo2History: [
      {
        time: {
          type: String,
          required: true,
        },
        spo2: {
          type: Number,
          required: true,
        },
        _id: false,
      },
    ],

    activityBreakdown: {
      type: Map,
      of: Number,
      default: {},
    },

    timestamp: {
      type: Number,
      required: true,
      index: true,
    },

    dataHash: {
      type: String,
      required: true,
    },

    deviceId: {
      type: String,
      required: true,
      index: true,
    },

    syncTime: {
      type: String,
      index: true,
    },

    driverName: {
      type: String,
      required: true,
      index: true,
    },

    vehicleId: String,
    routeId: String,

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
    timestamps: true,
    collection: "health_data",
  }
);

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

healthDataSchema.index({ deviceId: 1, timestamp: -1 });
healthDataSchema.index({ driverName: 1, date: -1 });
healthDataSchema.index({ createdAt: -1 });
healthDataSchema.index({ syncTime: -1 });
healthDataSchema.index({ date: 1, driverName: 1 });

healthDataSchema.virtual("heartRateCount").get(function () {
  return this.heartRateHistory?.length || 0;
});

healthDataSchema.virtual("avgHeartRate").get(function () {
  if (!this.heartRateHistory || this.heartRateHistory.length === 0) {
    return 0;
  }
  const sum = this.heartRateHistory.reduce((acc, curr) => acc + curr.heartRate, 0);
  return Math.round(sum / this.heartRateHistory.length);
});

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

healthDataSchema.virtual("avgSpo2").get(function () {
  if (!this.spo2History || this.spo2History.length === 0) {
    return 0;
  }
  const sum = this.spo2History.reduce((acc, curr) => acc + curr.spo2, 0);
  return Math.round((sum / this.spo2History.length) * 10) / 10;
});

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

healthDataSchema.statics.getDriverDataByDateRange = function (driverName, startDate, endDate) {
  return this.find({
    driverName: driverName,
    date: {
      $gte: startDate,
      $lte: endDate,
    },
  })
    .sort({ date: 1 })
    .lean();
};

healthDataSchema.statics.getLatestByDriver = function (driverName) {
  return this.findOne({ driverName: driverName }).sort({ date: -1, syncTime: -1 }).lean();
};

healthDataSchema.pre("save", function (next) {
  if (!this.date && this.timestamp) {
    const dateObj = new Date(this.timestamp);
    this.date = dateObj.toISOString().split("T")[0];
  }
  next();
});

healthDataSchema.pre("findOneAndUpdate", function (next) {
  this.set({ updatedAt: new Date() });
  next();
});

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

module.exports = mongoose.model("HealthData", healthDataSchema);
