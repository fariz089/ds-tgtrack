const mongoose = require("mongoose");

const coordinateSchema = new mongoose.Schema(
  {
    imei: {
      type: String,
      required: true,
      index: true,
    },
    device_key: String,
    vehicle_name: String,
    event_time: {
      type: Date,
      required: true,
      index: true,
    },
    receive_time: Date,
    time_zone: String,
    local_date: String,
    state: Number,
    warning: Number,
    lat: {
      type: Number,
      required: true,
    },
    lng: {
      type: Number,
      required: true,
    },
    speed: Number,
    azimuth: Number,
    height: Number,
    mileage: Number,
    additional: {
      gsm_signal: Number,
      satellites: Number,
      vehicle_signal_bit: Number,
      io: Number,
      alarm1078: {
        video_alarm: Number,
        video_loss: Number,
        video_shade: Number,
        storage_error: Number,
        unusual_driving: Number,
        fatigue_level: Number,
      },
      fence_list: [mongoose.Schema.Types.Mixed],
      alarm_list: [mongoose.Schema.Types.Mixed],
    },
    properties: {
      interval: Number,
      move_time: Date,
      acc_on_time: Date,
      daily_subtotal: {
        date: String,
        connect: Number,
        on_off: Number,
        duration: Number,
        start_mileage: Number,
        mileage: Number,
        gps_count: Number,
        gps_usable: Number,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Compound index untuk query performa
coordinateSchema.index({ imei: 1, event_time: -1 });
coordinateSchema.index({ vehicle_name: 1, event_time: -1 });
coordinateSchema.index({ event_time: -1 });

module.exports = mongoose.model("Coordinate", coordinateSchema);
