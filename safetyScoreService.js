const ADAS = require("./models/adas");
const DSM = require("./models/dsm");
const { getAlarmCategory } = require("./alarmTypes");

class SafetyScoreService {
  constructor() {
    // Weight berdasarkan severity dan kategori
    this.categoryWeights = {
      ADAS: {
        critical: 10, // FCW, PCW
        high: 8, // Halangan, terlalu dekat
        medium: 6, // LDW, melanggar rambu
        low: 4, // Sering ganti jalur, kamera terhalang
      },
      DSM: {
        critical: 10, // Lelah, mata tertutup, abnormal
        high: 8, // Tidak pegang setir, tidak sabuk
        medium: 7, // Telepon, tidak fokus
        low: 5, // Merokok, menguap
      },
      FM: {
        critical: 9, // Kelebihan kecepatan
        high: 7, // Pengereman mendadak
        medium: 6, // Akselerasi mendadak
        low: 5, // Belok/ganti jalur mendadak
      },
      BSD: {
        critical: 8, // Pendekatan dari belakang
        high: 7,
        medium: 6,
        low: 5,
      },
    };

    // Specific alarm type weights (override category defaults)
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
      "Snapshot otomatis": 1,
      "Event penggantian pengemudi": 1,

      // FM - Critical
      "Kelebihan kecepatan": 9,

      // FM - High/Medium
      "Pengereman mendadak": 7,
      "Akselerasi mendadak": 6,
      "Belok mendadak": 5,
      "Ganti jalur mendadak": 5,

      // BSD - All high priority
      "Alarm pendekatan dari belakang": 8,
      "Alarm pendekatan dari belakang kiri": 7,
      "Alarm pendekatan dari belakang kanan": 7,
    };
  }

  // Get weight untuk alarm type
  getAlarmWeight(alarmType, category) {
    // Cek specific weight dulu
    if (this.alarmWeights[alarmType]) {
      return this.alarmWeights[alarmType];
    }

    // Fallback ke category default weight
    if (category && this.categoryWeights[category]) {
      return this.categoryWeights[category].medium || 5;
    }

    // Default weight
    return 5;
  }

  // Determine severity level berdasarkan weight
  getSeverity(weight) {
    if (weight >= 9) return "critical";
    if (weight >= 7) return "high";
    if (weight >= 5) return "medium";
    return "low";
  }

  // Calculate safety score untuk vehicle dalam time range
  async calculateVehicleScore(vehicleName, hoursBack = 1) {
    const startTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const endTime = new Date();

    const query = {
      vehicle_name: new RegExp(vehicleName, "i"),
      event_time: { $gte: startTime, $lte: endTime },
    };

    const adasAlarms = await ADAS.find(query);
    const dsmAlarms = await DSM.find(query);

    let totalPenalty = 0;
    let severityCounts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    let categoryBreakdown = {
      ADAS: 0,
      DSM: 0,
      FM: 0,
      BSD: 0,
    };

    // Process ADAS alarms
    adasAlarms.forEach((alarm) => {
      const category = "ADAS";
      const weight = this.getAlarmWeight(alarm.alarm_type, category);
      const severity = this.getSeverity(weight);

      totalPenalty += weight;
      severityCounts[severity]++;
      categoryBreakdown.ADAS++;
    });

    // Process DSM alarms
    dsmAlarms.forEach((alarm) => {
      const category = "DSM";
      const weight = this.getAlarmWeight(alarm.alarm_type, category);
      const severity = this.getSeverity(weight);

      totalPenalty += weight;
      severityCounts[severity]++;
      categoryBreakdown.DSM++;
    });

    // Calculate score (100 - penalty, minimum 0)
    const baseScore = 100;
    const score = Math.max(0, baseScore - totalPenalty);

    return {
      vehicle_name: vehicleName,
      score: Math.round(score),
      grade: this.getGrade(score),
      total_alarms: adasAlarms.length + dsmAlarms.length,
      category_breakdown: categoryBreakdown,
      severity_counts: severityCounts,
      time_range: {
        start: startTime,
        end: endTime,
        hours: hoursBack,
      },
    };
  }

  // Calculate fleet-wide safety score
  async calculateFleetScore(hoursBack = 1) {
    const startTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const endTime = new Date();

    const query = {
      event_time: { $gte: startTime, $lte: endTime },
    };

    const adasAlarms = await ADAS.find(query);
    const dsmAlarms = await DSM.find(query);

    // Get unique vehicles
    const vehicleNames = [
      ...new Set([...adasAlarms.map((a) => a.vehicle_name), ...dsmAlarms.map((d) => d.vehicle_name)]),
    ].filter((v) => v && v !== "Unknown");

    let totalPenalty = 0;
    let severityCounts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    let categoryBreakdown = {
      ADAS: 0,
      DSM: 0,
      FM: 0,
      BSD: 0,
    };

    // Calculate penalties for ADAS
    adasAlarms.forEach((alarm) => {
      const category = "ADAS";
      const weight = this.getAlarmWeight(alarm.alarm_type, category);
      const severity = this.getSeverity(weight);

      totalPenalty += weight;
      severityCounts[severity]++;
      categoryBreakdown.ADAS++;
    });

    // Calculate penalties for DSM
    dsmAlarms.forEach((alarm) => {
      const category = "DSM";
      const weight = this.getAlarmWeight(alarm.alarm_type, category);
      const severity = this.getSeverity(weight);

      totalPenalty += weight;
      severityCounts[severity]++;
      categoryBreakdown.DSM++;
    });

    // Average score per vehicle
    const vehicleCount = vehicleNames.length || 1;
    const avgPenaltyPerVehicle = totalPenalty / vehicleCount;
    const fleetScore = Math.max(0, 100 - avgPenaltyPerVehicle);

    return {
      score: Math.round(fleetScore),
      grade: this.getGrade(fleetScore),
      total_vehicles: vehicleCount,
      total_alarms: adasAlarms.length + dsmAlarms.length,
      category_breakdown: categoryBreakdown,
      severity_counts: severityCounts,
      time_range: {
        start: startTime,
        end: endTime,
        hours: hoursBack,
      },
    };
  }

  // Get top risky vehicles
  async getRiskyVehicles(hoursBack = 1, limit = 5) {
    const startTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const endTime = new Date();

    const query = {
      event_time: { $gte: startTime, $lte: endTime },
    };

    const adasAlarms = await ADAS.find(query);
    const dsmAlarms = await DSM.find(query);

    // Group by vehicle
    const vehicleScores = {};

    // Process ADAS
    adasAlarms.forEach((alarm) => {
      const vehicleName = alarm.vehicle_name;
      if (!vehicleName || vehicleName === "Unknown") return;

      if (!vehicleScores[vehicleName]) {
        vehicleScores[vehicleName] = {
          vehicle_name: vehicleName,
          penalty: 0,
          alarms: [],
          severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
          categoryBreakdown: { ADAS: 0, DSM: 0, FM: 0, BSD: 0 },
        };
      }

      const category = "ADAS";
      const weight = this.getAlarmWeight(alarm.alarm_type, category);
      const severity = this.getSeverity(weight);

      vehicleScores[vehicleName].penalty += weight;
      vehicleScores[vehicleName].severityCounts[severity]++;
      vehicleScores[vehicleName].categoryBreakdown.ADAS++;
      vehicleScores[vehicleName].alarms.push({
        type: alarm.alarm_type,
        category: category,
        time: alarm.event_time,
        weight: weight,
        severity: severity,
      });
    });

    // Process DSM
    dsmAlarms.forEach((alarm) => {
      const vehicleName = alarm.vehicle_name;
      if (!vehicleName || vehicleName === "Unknown") return;

      if (!vehicleScores[vehicleName]) {
        vehicleScores[vehicleName] = {
          vehicle_name: vehicleName,
          penalty: 0,
          alarms: [],
          severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
          categoryBreakdown: { ADAS: 0, DSM: 0, FM: 0, BSD: 0 },
        };
      }

      const category = "DSM";
      const weight = this.getAlarmWeight(alarm.alarm_type, category);
      const severity = this.getSeverity(weight);

      vehicleScores[vehicleName].penalty += weight;
      vehicleScores[vehicleName].severityCounts[severity]++;
      vehicleScores[vehicleName].categoryBreakdown.DSM++;
      vehicleScores[vehicleName].alarms.push({
        type: alarm.alarm_type,
        category: category,
        time: alarm.event_time,
        weight: weight,
        severity: severity,
      });
    });

    // Convert to array and calculate scores
    const results = Object.values(vehicleScores).map((v) => ({
      vehicle_name: v.vehicle_name,
      score: Math.max(0, Math.round(100 - v.penalty)),
      grade: this.getGrade(100 - v.penalty),
      alarm_count: v.alarms.length,
      severity_counts: v.severityCounts,
      category_breakdown: v.categoryBreakdown,
      top_alarms: v.alarms.sort((a, b) => b.weight - a.weight).slice(0, 3), // Top 3 most severe alarms
    }));

    // Sort by score (lowest first = most risky)
    results.sort((a, b) => a.score - b.score);

    return results.slice(0, limit);
  }

  getGrade(score) {
    if (score >= 90) return { letter: "A", color: "#22c55e", label: "Excellent", icon: "🏆" };
    if (score >= 80) return { letter: "B", color: "#84cc16", label: "Good", icon: "👍" };
    if (score >= 70) return { letter: "C", color: "#f59e0b", label: "Fair", icon: "⚠️" };
    if (score >= 60) return { letter: "D", color: "#f97316", label: "Poor", icon: "⚡" };
    return { letter: "F", color: "#ef4444", label: "Critical", icon: "🚨" };
  }

  // Get alarm statistics breakdown
  async getAlarmStatistics(hoursBack = 24) {
    const startTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const endTime = new Date();

    const query = {
      event_time: { $gte: startTime, $lte: endTime },
    };

    const adasAlarms = await ADAS.find(query);
    const dsmAlarms = await DSM.find(query);

    // Count by alarm type
    const alarmTypeCounts = {};

    [...adasAlarms, ...dsmAlarms].forEach((alarm) => {
      const type = alarm.alarm_type;
      if (!alarmTypeCounts[type]) {
        alarmTypeCounts[type] = {
          count: 0,
          weight: this.getAlarmWeight(type, getAlarmCategory(alarm.platform_alarm_id)),
        };
      }
      alarmTypeCounts[type].count++;
    });

    // Sort by count
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
