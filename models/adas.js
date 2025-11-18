const mongoose = require("mongoose");

const adasSchema = new mongoose.Schema({
  vehicle_name: { type: String, required: true },
  lpn: { type: String, required: true },
  alarm_type: { type: String, required: true },
  speed: { type: Number, required: true },
  event_time: { type: Date, required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  files: [{
    file_name: { type: String, required: true },
    file_type: { type: Number, required: true },
    file_size: { type: Number, required: true },
    relative_path: { type: String, required: true }
  }],
});

const ADAS = mongoose.model('ADAS', adasSchema, 'adas');

module.exports = ADAS;
