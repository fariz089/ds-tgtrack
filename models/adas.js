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
    validation_status: {
      type: String,
      enum: ["correct", "incorrect", "pending"],
      default: "pending",
    },
    validated_by: String,
    validated_at: Date,
  },
  {
    timestamps: true,
  }
);

adasSchema.index({ alarm_key: 1 }, { unique: true, sparse: true });
adasSchema.index({ event_time: -1 });
adasSchema.index({ vehicle_name: 1 });
adasSchema.index({ vehicle_name: 1, event_time: -1 });
adasSchema.index({ validation_status: 1 });

module.exports = mongoose.model("ADAS", adasSchema);
