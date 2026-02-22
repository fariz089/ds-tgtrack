const mongoose = require("mongoose");

const vehicleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  display_name: String,
  lpn: {
    type: String,
    required: true,
  },
  imei: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  fleet_name: String,
  vehicle_type: String,
  install_date: Date,
  driver1: String,
  driver2: String,
  coDriver: String,
  status: {
    type: String,
    enum: ["active", "inactive", "maintenance"],
    default: "active",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Index untuk query cepat
vehicleSchema.index({ imei: 1 });
vehicleSchema.index({ lpn: 1 });
vehicleSchema.index({ name: 1 });

module.exports = mongoose.model("Vehicle", vehicleSchema);
