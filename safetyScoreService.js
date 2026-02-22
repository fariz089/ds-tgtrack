// safetyScoreService.js
// Fleet Safety Scoring - Normalized Reference-Based Exponential Decay Model
//
// Formula: score = 100 * exp(-(critical_rate/REF_CRITICAL + warning_rate/REF_WARNING) / 2)
//
// Where:
//   critical_rate = critical_events / active_vehicles
//   warning_rate = warning_events / active_vehicles
//   REF_CRITICAL = baseline critical events per vehicle (default: 10)
//   REF_WARNING = baseline warning events per vehicle (default: 20)
//
// Scoring curve:
//   0 alarms → 100 (A, Excellent)
//   1 crit + 5 warn per fleet of 6 → ~97 (A)
//   5 crit + 20 warn per fleet of 6 → ~88 (B)
//   15 crit + 30 warn per fleet of 6 → ~78 (C)
//   32 crit + 44 warn per fleet of 6 → ~64 (D)
//   50 crit + 80 warn per fleet of 6 → ~47 (F)

const ADAS = require("./models/adas");
const DSM = require("./models/dsm");
const { getAlarmCategory } = require("./alarmTypes");

class SafetyScoreService {
  constructor() {
    // Reference baselines (tunable)
    // These represent "moderately bad" performance per vehicle
    this.REF_CRITICAL = 10; // critical events per vehicle per time period
    this.REF_WARNING = 20; // warning events per vehicle per time period

    // Weight berdasarkan severity dan kategori
    this.categoryWeights = {
      ADAS: {
        critical: 10,
        high: 8,
        medium: 6,
        low: 4,
      },
      DSM: {
        critical: 10,
        high: 8,
        medium: 7,
        low: 5,
      },
      FM: {
        critical: 9,
        high: 7,
        medium: 6,
        low: 5,
      },
      BSD: {
        critical: 8,
        high: 7,
        medium: 6,
        low: 5,
      },
    };

    // Specific alarm type weights
    this.alarmWeights = {
      // ADAS - Critical
      "Peringatan tabrakan depan (FCW)": 10,
      "Peringatan tabrakan pejalan kaki (PCW)": 10,

      // ADAS - High
      "Alarm halangan": 8,
      "Alarm kendaraan terlalu dekat": 8,

      // ADAS - Medium
      "Peringatan keluar jalur (LDW)": 6,
      "Alarm melanggar rambu jalan": 7,

      // ADAS - Low
      "Alarm sering ganti jalur": 4,
      "Kamera depan terhalang": 3,
      "Pengenalan rambu jalan": 2,
      "Snapshot otomatis": 1,

      // DSM - Critical
      "Alarm mengemudi dalam keadaan lelah": 10,
      "Alarm mata pengemudi tertutup": 10,
      "Alarm kondisi pengemudi abnormal": 9,

      // DSM - High
      "Kedua tangan tidak memegang setir": 8,
      "Tidak memakai sabuk pengaman": 8,

      // DSM - Medium
      "Menggunakan telepon": 7,
      "Alarm pengemudi tidak fokus": 7,
      "Identitas pengemudi abnormal": 7,

      // DSM - Low
      "Alarm merokok": 6,
      "Alarm menguap": 4,
      "Mengemudi melebihi waktu": 6,
      "Tidak mengemudi malam hari": 3,
      "Fungsi monitoring DSM gagal": 2,
      "Alarm infrared terhalang": 2,
      "Lensa kamera terhalang": 2,

      // FM - Critical
      "Kelebihan kecepatan": 9,

      // FM - High/Medium
      "Pengereman mendadak": 7,
      "Akselerasi mendadak": 6,
      "Belok mendadak": 5,
      "Ganti jalur mendadak": 5,

      // BSD
      "Alarm pendekatan dari belakang": 8,
      "Alarm pendekatan dari belakang kiri": 7,
      "Alarm pendekatan dari belakang kanan": 7,
    };
  }

  // Get weight untuk alarm type
  getAlarmWeight(alarmType, category) {
    if (this.alarmWeights[alarmType]) {
      return this.alarmWeights[alarmType];
    }
    if (category && this.categoryWeights[category]) {
      return this.categoryWeights[category].medium || 5;
    }
    return 5;
  }

  // Determine severity level berdasarkan weight
  getSeverity(weight) {
    if (weight >= 9) return "critical";
    if (weight >= 7) return "high";
    if (weight >= 5) return "medium";
    return "low";
  }

  // ================= CORE SCORING FUNCTION =================
  // Normalized exponential decay scoring
  // Returns 0-100, accounts for fleet size
  calculateNormalizedScore(severityCounts, vehicleCount) {
    const activeVehicles = Math.max(vehicleCount, 1);

    // Critical = critical + high severity events
    const criticalEvents = (severityCounts.critical || 0) + (severityCounts.high || 0);
    // Warning = medium + low severity events
    const warningEvents = (severityCounts.medium || 0) + (severityCounts.low || 0);

    // Normalize per vehicle
    const criticalRate = criticalEvents / activeVehicles;
    const warningRate = warningEvents / activeVehicles;

    // Exponential decay with reference baselines
    const normalizedPenalty =
      criticalRate / this.REF_CRITICAL + warningRate / this.REF_WARNING;
    const score = 100 * Math.exp(-normalizedPenalty / 2);

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  // ================= VEHICLE SCORE (PER BUS) =================
  async calculateVehicleScore(vehicleName, hoursBack = 1) {
    const startTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const endTime = new Date();

    const query = {
      vehicle_name: new RegExp(vehicleName, "i"),
      event_time: { $gte: startTime, $lte: endTime },
    };

    const adasAlarms = await ADAS.find(query);
    const dsmAlarms = await DSM.find(query);

    let severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    let categoryBreakdown = { ADAS: 0, DSM: 0, FM: 0, BSD: 0 };

    adasAlarms.forEach((alarm) => {
      const weight = this.getAlarmWeight(alarm.alarm_type, "ADAS");
      const severity = this.getSeverity(weight);
      severityCounts[severity]++;
      categoryBreakdown.ADAS++;
    });

    dsmAlarms.forEach((alarm) => {
      const weight = this.getAlarmWeight(alarm.alarm_type, "DSM");
      const severity = this.getSeverity(weight);
      severityCounts[severity]++;
      categoryBreakdown.DSM++;
    });

    // For single vehicle, use vehicleCount = 1
    const score = this.calculateNormalizedScore(severityCounts, 1);

    return {
      vehicle_name: vehicleName,
      score,
      grade: this.getGrade(score),
      total_alarms: adasAlarms.length + dsmAlarms.length,
      category_breakdown: categoryBreakdown,
      severity_counts: severityCounts,
      time_range: { start: startTime, end: endTime, hours: hoursBack },
    };
  }

  // ================= FLEET SCORE (SEMUA BUS) =================
  async calculateFleetScore(options = {}) {
    let startTime, endTime, hoursUsed;

    if (options.startDate && options.endDate) {
      startTime = new Date(options.startDate);
      endTime = new Date(options.endDate);
      hoursUsed = Math.max((endTime - startTime) / (60 * 60 * 1000), 0);
    } else {
      const hoursBack = options.hoursBack || 1;
      endTime = new Date();
      startTime = new Date(endTime.getTime() - hoursBack * 60 * 60 * 1000);
      hoursUsed = hoursBack;
    }

    const query = { event_time: { $gte: startTime, $lte: endTime } };

    const adasAlarms = await ADAS.find(query);
    const dsmAlarms = await DSM.find(query);

    // Get unique vehicles
    const vehicleNames = [
      ...new Set([
        ...adasAlarms.map((a) => a.vehicle_name),
        ...dsmAlarms.map((d) => d.vehicle_name),
      ]),
    ].filter((v) => v && v !== "Unknown");

    let severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    let categoryBreakdown = { ADAS: 0, DSM: 0, FM: 0, BSD: 0 };

    adasAlarms.forEach((alarm) => {
      const weight = this.getAlarmWeight(alarm.alarm_type, "ADAS");
      const severity = this.getSeverity(weight);
      severityCounts[severity]++;
      categoryBreakdown.ADAS++;
    });

    dsmAlarms.forEach((alarm) => {
      const weight = this.getAlarmWeight(alarm.alarm_type, "DSM");
      const severity = this.getSeverity(weight);
      severityCounts[severity]++;
      categoryBreakdown.DSM++;
    });

    // Calculate fleet score normalized by vehicle count
    const vehicleCount = vehicleNames.length || 1;
    const score = this.calculateNormalizedScore(severityCounts, vehicleCount);

    return {
      score,
      grade: this.getGrade(score),
      total_vehicles: vehicleNames.length,
      total_alarms: adasAlarms.length + dsmAlarms.length,
      category_breakdown: categoryBreakdown,
      severity_counts: severityCounts,
      time_range: { start: startTime, end: endTime, hours: hoursUsed },
    };
  }

  // ================= RISKY VEHICLES =================
  async getRiskyVehicles(options = {}) {
    const limit = options.limit || 5;
    let startTime, endTime;

    if (options.startDate && options.endDate) {
      startTime = new Date(options.startDate);
      endTime = new Date(options.endDate);
    } else {
      const hoursBack = options.hoursBack || 1;
      endTime = new Date();
      startTime = new Date(endTime.getTime() - hoursBack * 60 * 60 * 1000);
    }

    const query = { event_time: { $gte: startTime, $lte: endTime } };

    const adasAlarms = await ADAS.find(query);
    const dsmAlarms = await DSM.find(query);

    // Group by vehicle
    const vehicleScores = {};

    const processAlarm = (alarm, category) => {
      const vehicleName = alarm.vehicle_name;
      if (!vehicleName || vehicleName === "Unknown") return;

      if (!vehicleScores[vehicleName]) {
        vehicleScores[vehicleName] = {
          vehicle_name: vehicleName,
          alarms: [],
          severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
          categoryBreakdown: { ADAS: 0, DSM: 0, FM: 0, BSD: 0 },
        };
      }

      const weight = this.getAlarmWeight(alarm.alarm_type, category);
      const severity = this.getSeverity(weight);

      vehicleScores[vehicleName].severityCounts[severity]++;
      vehicleScores[vehicleName].categoryBreakdown[category]++;
      vehicleScores[vehicleName].alarms.push({
        type: alarm.alarm_type,
        category,
        time: alarm.event_time,
        weight,
        severity,
      });
    };

    adasAlarms.forEach((alarm) => processAlarm(alarm, "ADAS"));
    dsmAlarms.forEach((alarm) => processAlarm(alarm, "DSM"));

    // Calculate per-vehicle scores
    const results = Object.values(vehicleScores).map((v) => {
      const score = this.calculateNormalizedScore(v.severityCounts, 1);
      return {
        vehicle_name: v.vehicle_name,
        score,
        grade: this.getGrade(score),
        alarm_count: v.alarms.length,
        severity_counts: v.severityCounts,
        category_breakdown: v.categoryBreakdown,
        top_alarms: v.alarms.sort((a, b) => b.weight - a.weight).slice(0, 3),
      };
    });

    // Sort from riskiest (lowest score)
    results.sort((a, b) => a.score - b.score);

    return results.slice(0, limit);
  }

  // ================= GRADE & STATISTICS =================
  getGrade(score) {
    if (score >= 90)
      return { letter: "A", color: "#22c55e", label: "Excellent", icon: "🏆" };
    if (score >= 80)
      return { letter: "B", color: "#84cc16", label: "Good", icon: "👍" };
    if (score >= 70)
      return { letter: "C", color: "#f59e0b", label: "Fair", icon: "⚠️" };
    if (score >= 60)
      return { letter: "D", color: "#f97316", label: "Poor", icon: "⚡" };
    return { letter: "F", color: "#ef4444", label: "Critical", icon: "🚨" };
  }

  // Get alarm statistics breakdown
  async getAlarmStatistics(hoursBack = 24) {
    const startTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const endTime = new Date();

    const query = { event_time: { $gte: startTime, $lte: endTime } };

    const adasAlarms = await ADAS.find(query);
    const dsmAlarms = await DSM.find(query);

    const alarmTypeCounts = {};

    [...adasAlarms, ...dsmAlarms].forEach((alarm) => {
      const type = alarm.alarm_type;
      if (!alarmTypeCounts[type]) {
        alarmTypeCounts[type] = {
          count: 0,
          weight: this.getAlarmWeight(
            type,
            getAlarmCategory(alarm.platform_alarm_id)
          ),
        };
      }
      alarmTypeCounts[type].count++;
    });

    const sorted = Object.entries(alarmTypeCounts)
      .map(([type, data]) => ({
        alarm_type: type,
        count: data.count,
        weight: data.weight,
      }))
      .sort((a, b) => b.count - a.count);

    return sorted;
  }
}

module.exports = SafetyScoreService;
