const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  vehicleName: { type: String, required: true },
  alertType: { type: String, required: true },
  speed: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now }
});

const Alert = mongoose.model('Alert', alertSchema);

module.exports = Alert;
