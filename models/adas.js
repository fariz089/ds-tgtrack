const mongoose = require("mongoose");

const adasSchema = new mongoose.Schema(
  {
    vehicle_name: String,
    lpn: String,
    alarm_type: String,
    speed: Number,
    event_time: Date,
    lat: Number,
    lng: Number,
    alarm_key: String,
    platform_alarm_id: Number,
    files: [
      {
        file_name: String,
        file_type: Number,
        file_size: Number,
        relative_path: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Unique identifier dari API sebagai primary key
adasSchema.index({ alarm_key: 1 }, { unique: true, sparse: true });

// Index untuk query berdasarkan waktu dan kendaraan
adasSchema.index({ event_time: -1 });
adasSchema.index({ vehicle_name: 1 });
adasSchema.index({ vehicle_name: 1, event_time: -1 });

module.exports = mongoose.model("ADAS", adasSchema);
