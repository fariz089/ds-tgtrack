// alarmTypes.js

const alarmSafetyType = {
  // Unknown
  0: "Tidak Diketahui",

  // ADAS Alarms (25601-25617)
  25601: "Peringatan tabrakan depan (FCW)",
  25602: "Peringatan keluar jalur (LDW)",
  25603: "Alarm kendaraan terlalu dekat",
  25604: "Peringatan tabrakan pejalan kaki (PCW)",
  25605: "Alarm sering ganti jalur",
  25606: "Alarm melanggar rambu jalan",
  25607: "Alarm halangan",
  25608: "Kamera depan terhalang",
  25616: "Pengenalan rambu jalan",
  25617: "Snapshot otomatis",

  // DSM Alarms (25857-25888)
  25857: "Alarm mengemudi dalam keadaan lelah",
  25858: "Menggunakan telepon",
  25859: "Alarm merokok",
  25860: "Alarm pengemudi tidak fokus",
  25861: "Alarm kondisi pengemudi abnormal",
  25862: "Kedua tangan tidak memegang setir",
  25863: "Fungsi monitoring DSM gagal",
  25864: "Tidak memakai sabuk pengaman",
  25865: "Alarm menguap",
  25866: "Alarm infrared terhalang",
  25867: "Lensa kamera terhalang",
  25868: "User defined 0c",
  25869: "User defined 0d",
  25870: "Tidak mengemudi malam hari",
  25871: "Mengemudi melebihi waktu",
  25872: "Snapshot otomatis",
  25873: "Event penggantian pengemudi",
  25874: "Identitas pengemudi abnormal",
  25884: "User defined 1c",
  25888: "Alarm mata pengemudi tertutup",

  // FM Alarms (59392-59416)
  59392: "Kelebihan kecepatan",
  59408: "Akselerasi mendadak",
  59409: "Pengereman mendadak",
  59415: "Belok mendadak",
  59416: "Ganti jalur mendadak",

  // BSD Alarms (26369-26371)
  26369: "Alarm pendekatan dari belakang",
  26370: "Alarm pendekatan dari belakang kiri",
  26371: "Alarm pendekatan dari belakang kanan",
};

// Get alarm type name by platform_alarm_id
function getAlarmTypeName(platformAlarmId) {
  return alarmSafetyType[platformAlarmId] || `Alarm Tidak Diketahui (ID: ${platformAlarmId})`;
}

// Get alarm category by platform_alarm_id
function getAlarmCategory(platformAlarmId) {
  if (platformAlarmId >= 25601 && platformAlarmId <= 25617) {
    return "ADAS";
  } else if (
    (platformAlarmId >= 25857 && platformAlarmId <= 25874) ||
    platformAlarmId === 25884 ||
    platformAlarmId === 25888
  ) {
    return "DSM";
  } else if (platformAlarmId >= 59392 && platformAlarmId <= 59416) {
    return "FM";
  } else if (platformAlarmId >= 26369 && platformAlarmId <= 26371) {
    return "BSD";
  }
  return "Tidak Diketahui";
}

// Get emoji icon based on category
function getAlarmIcon(platformAlarmId) {
  const category = getAlarmCategory(platformAlarmId);
  switch (category) {
    case "ADAS":
      return "🚗"; // Vehicle/collision related
    case "DSM":
      return "😴"; // Driver monitoring
    case "FM":
      return "⚡"; // Fleet management/speed
    case "BSD":
      return "👁️"; // Blind spot detection
    default:
      return "⚠️";
  }
}

module.exports = {
  alarmSafetyType,
  getAlarmTypeName,
  getAlarmCategory,
  getAlarmIcon,
};
