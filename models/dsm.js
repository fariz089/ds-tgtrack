const mongoose = require("mongoose");

const dsmSchema = new mongoose.Schema(
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

dsmSchema.index({ alarm_key: 1 }, { unique: true, sparse: true });
dsmSchema.index({ event_time: -1 });
dsmSchema.index({ vehicle_name: 1 });
dsmSchema.index({ vehicle_name: 1, event_time: -1 });
dsmSchema.index({ validation_status: 1 });

module.exports = mongoose.model("DSM", dsmSchema);
