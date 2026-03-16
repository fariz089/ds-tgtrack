// Command Center JavaScript
let map;
let markers = [];
let selectedVehicle = null;
let vehiclesData = [];
let currentAlarmTab = "all";
let sfJmuxer = null;
let sfWebSocket = null;

// ✅ Missing function
function closeVehicleModal() {
  const modal = document.getElementById("vehicleModal");
  if (modal) {
    modal.classList.remove("active");
  }
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  // console.log("✅ mpegts.js loaded:", typeof mpegts !== "undefined" ? mpegts.version : "NOT LOADED");

  loadVehicles();

  // Refresh every 30 seconds
  setInterval(loadVehicles, 30000);
});

// Initialize Google Maps
function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: -6.9, lng: 107.6 },
    zoom: 12,
    styles: [
      {
        featureType: "poi",
        stylers: [{ visibility: "off" }],
      },
    ],
  });
}

// Load vehicles data
async function loadVehicles() {
  try {
    const response = await fetch("/api/command-center/vehicles");
    vehiclesData = await response.json();

    renderVehicleGrid();
    updateStats();

    if (selectedVehicle) {
      loadVehicleAlarms(selectedVehicle);
    }
  } catch (err) {
    console.error("Error loading vehicles:", err);
  }
}

// Determine vehicle status based on speed, ACC state, and last update time
// Matches ds.tgtrack.com status display: Driving, Idling, Parking, Offline
function getVehicleStatus(vehicle) {
  if (!vehicle.location || !vehicle.location.event_time) {
    return { isOnline: false, statusText: 'Offline', statusClass: 'offline', timeAgo: '' };
  }
  
  const lastUpdate = new Date(vehicle.location.event_time);
  const now = new Date();
  const minutesAgo = (now - lastUpdate) / (1000 * 60);
  const hoursAgo = minutesAgo / 60;
  const daysAgo = hoursAgo / 24;
  
  // Format time ago string
  let timeAgo = '';
  if (minutesAgo < 60) {
    timeAgo = `${Math.round(minutesAgo)} minutes ago`;
  } else if (hoursAgo < 24) {
    timeAgo = `${Math.round(hoursAgo)} hours ago`;
  } else if (daysAgo < 30) {
    timeAgo = `${Math.round(daysAgo)} days ago`;
  } else {
    timeAgo = `${Math.round(daysAgo / 30)} months ago`;
  }
  
  const speed = vehicle.location.speed || 0;
  const accOn = vehicle.location.acc_on;
  
  // Offline: no data for more than 30 minutes
  if (minutesAgo > 30) {
    return { 
      isOnline: false, 
      statusText: 'Offline', 
      statusClass: 'offline',
      timeAgo: timeAgo
    };
  }
  
  // Driving: speed > 0 and recent data
  if (speed > 0) {
    return { 
      isOnline: true, 
      statusText: 'Driving', 
      statusClass: 'driving',
      speed: speed,
      timeAgo: ''
    };
  }
  
  // Idling: ACC ON but not moving (speed = 0, recent data)
  if (accOn && speed === 0 && minutesAgo <= 10) {
    return { 
      isOnline: true, 
      statusText: 'Idling', 
      statusClass: 'idling',
      timeAgo: timeAgo
    };
  }
  
  // Parking: ACC OFF or speed 0 for a while
  if (minutesAgo <= 30) {
    return { 
      isOnline: true, 
      statusText: 'Parking', 
      statusClass: 'parking',
      timeAgo: timeAgo
    };
  }
  
  return { 
    isOnline: false, 
    statusText: 'Offline', 
    statusClass: 'offline',
    timeAgo: timeAgo
  };
}

// Render vehicle grid
function renderVehicleGrid() {
  const grid = document.getElementById("vehicleGrid");

  grid.innerHTML = vehiclesData
    .map((vehicle) => {
      const scoreClass = vehicle.safety_score >= 80 ? "" : vehicle.safety_score >= 60 ? "warning" : "danger";
      const isSelected = selectedVehicle === vehicle.vehicle_name;
      const status = getVehicleStatus(vehicle);
      
      // Status display text with speed or time ago
      let statusDisplay = status.statusText;
      if (status.statusClass === 'driving' && status.speed) {
        statusDisplay = `${status.statusText}[${status.speed} km/h]`;
      } else if (status.timeAgo && status.statusClass !== 'driving') {
        statusDisplay = `${status.statusText}[${status.timeAgo}]`;
      }

      return `
      <div class="vehicle-card ${isSelected ? "selected" : ""}" 
           onclick="selectVehicle('${vehicle.vehicle_name}')">
        <div class="vehicle-card-header">
          <div class="vehicle-avatar">
            <i class="fas fa-bus"></i>
          </div>
          <div class="vehicle-title">
            <h4>${vehicle.vehicle_name}</h4>
            <div class="vehicle-status ${status.statusClass}">
              <span class="status-dot ${status.statusClass}"></span>
              ${statusDisplay}
            </div>
          </div>
        </div>
        
        <div class="safety-score ${scoreClass}">
          ${vehicle.safety_score}
        </div>
        
        <div class="vehicle-stats">
          <div class="vehicle-stat">
            <div class="vehicle-stat-value">${vehicle.alarms.adas}</div>
            <div class="vehicle-stat-label">ADAS</div>
          </div>
          <div class="vehicle-stat">
            <div class="vehicle-stat-value">${vehicle.alarms.dsm}</div>
            <div class="vehicle-stat-label">DSM</div>
          </div>
          <div class="vehicle-stat">
            <div class="vehicle-stat-value">${vehicle.alarms.total_correct}</div>
            <div class="vehicle-stat-label">Valid</div>
          </div>
          <div class="vehicle-stat">
            <div class="vehicle-stat-value">${vehicle.location ? vehicle.location.speed : 0}</div>
            <div class="vehicle-stat-label">km/h</div>
          </div>
        </div>
        
        <div class="vehicle-actions">
          <button class="btn-action btn-view" onclick="openVehicleModal('${vehicle.vehicle_name}', '${
        vehicle.imei
      }'); event.stopPropagation();">
            <i class="fas fa-eye"></i> View Details
          </button>
          <button class="btn-action btn-camera" onclick="openCamera('${vehicle.imei}', 1, '${
        vehicle.vehicle_name
      }'); event.stopPropagation();">
            <i class="fas fa-video"></i> Camera
          </button>
        </div>
      </div>
    `;
    })
    .join("");
}

// Update stats
function updateStats() {
  const totalVehicles = vehiclesData.length;
  const totalAlarms = vehiclesData.reduce((sum, v) => sum + v.alarms.total, 0);
  const avgScore = vehiclesData.reduce((sum, v) => sum + v.safety_score, 0) / totalVehicles;

  document.getElementById("totalVehicles").textContent = totalVehicles;
  document.getElementById("totalAlarms").textContent = totalAlarms;
  document.getElementById("avgScore").textContent = avgScore.toFixed(0);
}

// Select vehicle
function selectVehicle(vehicleName) {
  selectedVehicle = vehicleName;
  renderVehicleGrid();

  document.getElementById("mapTitle").textContent = `${vehicleName} - Tracking`;

  loadVehicleAlarms(vehicleName);
}

// Load vehicle alarms on map
async function loadVehicleAlarms(vehicleName) {
  try {
    markers.forEach((marker) => marker.setMap(null));
    markers = [];

    const response = await fetch(`/api/command-center/vehicle-alarms/${vehicleName}`);
    const data = await response.json();

    const vehicle = vehiclesData.find((v) => v.vehicle_name === vehicleName);

    if (!vehicle || !vehicle.location) return;

    map.setCenter({ lat: vehicle.location.lat, lng: vehicle.location.lng });
    map.setZoom(14);

    const vehicleMarker = new google.maps.Marker({
      position: { lat: vehicle.location.lat, lng: vehicle.location.lng },
      map: map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: "#0066a1",
        fillOpacity: 1,
        strokeColor: "white",
        strokeWeight: 3,
      },
      title: vehicleName,
    });

    markers.push(vehicleMarker);

    data.alarms.forEach((alarm) => {
      const color = alarm.type === "ADAS" ? "#ef4444" : "#f59e0b";

      const marker = new google.maps.Marker({
        position: { lat: alarm.lat, lng: alarm.lng },
        map: map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: color,
          fillOpacity: 0.8,
          strokeColor: "white",
          strokeWeight: 2,
        },
        title: alarm.alarm_type,
      });

      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="padding: 10px;">
            <strong>${alarm.type}: ${alarm.alarm_type}</strong><br>
            <small>${new Date(alarm.event_time).toLocaleString("id-ID")}</small><br>
            <small>Status: ${alarm.validation_status || "pending"}</small>
          </div>
        `,
      });

      marker.addListener("click", () => {
        infoWindow.open(map, marker);
      });

      markers.push(marker);
    });
  } catch (err) {
    console.error("Error loading vehicle alarms:", err);
  }
}

// Open vehicle modal
async function openVehicleModal(vehicleName, imei) {
  const modal = document.getElementById("vehicleModal");
  document.getElementById("modalVehicleName").textContent = vehicleName;

  const cameraGrid = document.getElementById("cameraGridModal");
  cameraGrid.innerHTML = '<div style="text-align:center;padding:10px;color:#999;"><i class="fas fa-spinner fa-spin"></i> Loading cameras...</div>';

  // Check vehicle source to show appropriate camera buttons
  try {
    const sourceResp = await fetch(`/api/vehicle-source/${imei}`);
    const sourceData = await sourceResp.json();

    if (sourceData.source === "carcentro") {
      // Fetch CarCentro-specific channel config
      const configResp = await fetch(`/api/carcentro/video-config/${imei}`);
      const configData = await configResp.json();

      if (configData.channels && configData.channels.length > 0) {
        cameraGrid.innerHTML = configData.channels.map(ch => `
          <button class="camera-btn-modal" onclick="openCarCentroCCTV('${imei}', ${ch.channel}, '${vehicleName}', '${ch.name}')" title="${ch.name}">
            <i class="fas fa-video"></i> ${ch.name}
          </button>
        `).join('') + `
          <div style="margin-top:8px;font-size:11px;color:#999;grid-column:1/-1;text-align:center;">
            <i class="fas fa-info-circle"></i> CCTV via CarCentro (AoooG) — opens in portal
          </div>
        `;
      } else {
        cameraGrid.innerHTML = `
          <div style="text-align:center;padding:15px;color:#999;">
            <i class="fas fa-video-slash" style="font-size:24px;margin-bottom:8px;display:block;"></i>
            No camera config available
          </div>
        `;
      }
    } else {
      // TGTrack / SoloFleet: show 8 generic camera buttons
      cameraGrid.innerHTML = Array.from(
        { length: 8 },
        (_, i) => `
        <button class="camera-btn-modal" onclick="openCamera('${imei}', ${i + 1}, '${vehicleName}')">
          <i class="fas fa-video"></i> Camera ${i + 1}
        </button>
      `
      ).join("");
    }
  } catch (err) {
    // Fallback: show generic 8 cameras
    cameraGrid.innerHTML = Array.from(
      { length: 8 },
      (_, i) => `
      <button class="camera-btn-modal" onclick="openCamera('${imei}', ${i + 1}, '${vehicleName}')">
        <i class="fas fa-video"></i> Camera ${i + 1}
      </button>
    `
    ).join("");
  }

  await loadVehicleAlarms2(vehicleName);

  modal.classList.add("active");
}

// Load vehicle alarms for modal
async function loadVehicleAlarms2(vehicleName) {
  try {
    const response = await fetch(`/api/command-center/vehicle/${vehicleName}`);
    const data = await response.json();

    const allAlarms = [
      ...data.alarms.adas.map((a) => ({ ...a, type: "ADAS" })),
      ...data.alarms.dsm.map((a) => ({ ...a, type: "DSM" })),
    ].sort((a, b) => new Date(b.event_time) - new Date(a.event_time));

    window.currentAlarms = allAlarms;
    renderAlarms();
  } catch (err) {
    console.error("Error loading vehicle alarms:", err);
  }
}

// Validate alarm
async function validateAlarm(alarmKey, alarmType, status) {
  try {
    console.log(`Validating: ${alarmKey} as ${status}`);

    const response = await fetch("/api/command-center/validate-alarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        alarm_key: alarmKey,
        alarm_type: alarmType,
        status: status,
        validated_by: "admin",
      }),
    });

    const result = await response.json();

    if (result.success) {
      // console.log(`✅ Alarm ${alarmKey} marked as ${status}`);

      // Update local data
      if (window.currentAlarms) {
        const alarm = window.currentAlarms.find((a) => a.alarm_key === alarmKey);
        if (alarm) {
          alarm.validation_status = status;
          console.log("Updated alarm:", alarm);
        }
      }

      // Force re-render with slight delay to ensure state update
      setTimeout(() => {
        renderAlarms();
        console.log("Re-rendered alarms");
      }, 100);

      // Refresh vehicle stats
      loadVehicles();
    } else {
      console.error("Validation failed:", result);
      alert(`Failed to validate alarm: ${result.error || "Unknown error"}`);
    }
  } catch (err) {
    console.error("Error validating alarm:", err);
    alert(`Error: ${err.message}`);
  }
}

// Switch alarm tab
function switchAlarmTab(tab) {
  currentAlarmTab = tab;

  document.querySelectorAll(".alarm-tab").forEach((btn) => {
    btn.classList.remove("active");
  });

  event.target.classList.add("active");

  renderAlarms();
}

// Render alarms list with ALL previews (FIXED)
function renderAlarms() {
  if (!window.currentAlarms) return;

  let filtered = window.currentAlarms;

  if (currentAlarmTab === "adas") {
    filtered = filtered.filter((a) => a.type === "ADAS");
  } else if (currentAlarmTab === "dsm") {
    filtered = filtered.filter((a) => a.type === "DSM");
  } else if (currentAlarmTab === "pending") {
    filtered = filtered.filter((a) => a.validation_status === "pending");
  }

  const list = document.getElementById("alarmsList");

  if (filtered.length === 0) {
    list.innerHTML = '<div style="text-align: center; padding: 40px; color: #9ca3af;">No alarms found</div>';
    return;
  }

  list.innerHTML = filtered
    .map((alarm) => {
      const typeClass = alarm.type.toLowerCase();
      const validationClass = alarm.validation_status ? `validated-${alarm.validation_status}` : "";

      // Render ALL files as thumbnails (images and videos)
      let previewsHtml = "";
      if (alarm.files && alarm.files.length > 0) {
        const previews = alarm.files
          .filter((f) => f.file_type === 0 || f.file_type === 2) // Images and videos only
          .map((file) => {
            if (file.file_type === 0) {
              // Image - use img tag for thumbnail
              return `
                <div class="alarm-preview-small" onclick="openAlarmPreview('${file.relative_path}', 'image')" title="Click to view full image">
                  <img src="${file.relative_path}" alt="Preview" onerror="this.parentElement.innerHTML='<div class=alarm-preview-placeholder>Error</div>'">
                </div>
              `;
            } else if (file.file_type === 2) {
              // Video - show play icon
              return `
                <div class="alarm-preview-small video" onclick="openAlarmPreview('${file.relative_path}', 'video')" title="Click to play video">
                  <i class="fas fa-play-circle"></i>
                  <span class="video-badge">Video</span>
                </div>
              `;
            }
            return "";
          })
          .join("");

        previewsHtml = `<div class="alarm-previews">${previews}</div>`;
      } else {
        previewsHtml = `
          <div class="alarm-preview-small">
            <div class="alarm-preview-placeholder">No Files</div>
          </div>
        `;
      }

      return `
      <div class="alarm-item ${typeClass} ${validationClass}">
        <div class="alarm-icon ${typeClass}">
          <i class="fas fa-${alarm.type === "ADAS" ? "car-crash" : "user-shield"}"></i>
        </div>
        
        ${previewsHtml}
        
        <div class="alarm-content">
          <div class="alarm-type">${alarm.alarm_type}</div>
          <div class="alarm-time">
            <i class="fas fa-clock"></i> ${new Date(alarm.event_time).toLocaleString("id-ID")}
          </div>
          <div class="alarm-details">
            Speed: ${alarm.speed} km/h | Location: ${alarm.lat.toFixed(4)}, ${alarm.lng.toFixed(4)}
          </div>
        </div>
        <div class="alarm-actions">
          <button class="btn-validate btn-correct ${alarm.validation_status === "correct" ? "active" : ""}"
                  onclick="validateAlarm('${alarm.alarm_key}', '${alarm.type}', 'correct')">
            <i class="fas fa-check"></i> Correct
          </button>
          <button class="btn-validate btn-incorrect ${alarm.validation_status === "incorrect" ? "active" : ""}"
                  onclick="validateAlarm('${alarm.alarm_key}', '${alarm.type}', 'incorrect')">
            <i class="fas fa-times"></i> Incorrect
          </button>
        </div>
      </div>
    `;
    })
    .join("");
}

// Open alarm preview - SEPARATE for image and video
function openAlarmPreview(fileUrl, type) {
  if (type === "image") {
    openImagePreview(fileUrl);
  } else if (type === "video") {
    openVideoPreview(fileUrl);
  }
}

// Open image preview
function openImagePreview(imageUrl) {
  const modal = document.getElementById("imageModal");
  const image = document.getElementById("imagePreview");
  const info = document.getElementById("imageInfo");

  console.log("Opening image:", imageUrl);

  image.src = imageUrl;
  image.onerror = () => {
    info.textContent = "Error loading image";
    console.error("Failed to load image:", imageUrl);
  };
  image.onload = () => {
    info.textContent = "Alarm Evidence - Image";
  };

  modal.classList.add("active");
}

// Open video preview
function openVideoPreview(videoUrl) {
  const modal = document.getElementById("videoModal");
  const player = document.getElementById("videoPlayer");
  const info = document.getElementById("videoInfo");

  console.log("Opening video:", videoUrl);

  // Stop any active stream players
  cleanupAllPlayers();

  player.src = videoUrl;
  player.play().catch((err) => {
    console.error("Error playing video:", err);
    info.textContent = "Error loading video";
  });
  info.textContent = "Alarm Evidence - Video";

  modal.classList.add("active");
}

// Close image modal
function closeImage() {
  const modal = document.getElementById("imageModal");
  const image = document.getElementById("imagePreview");

  image.src = "";
  modal.classList.remove("active");
}

// ============================================================
// VIDEO PLAYER ENGINE v2.0
// Stack: mpegts.js (FLV/MPEG-TS) + HLS.js (M3U8) + JMuxer (SoloFleet H.264)
// Fallback chain: HLS → mpegts.js FLV → mpegts.js direct HTTP → error
// ============================================================

let hlsPlayer = null;
let mpegtsPlayer = null;
let currentStreamAttempt = 0; // Track retry attempts
const MAX_STREAM_RETRIES = 2;

// ── Main entry point ──────────────────────────────────────
function openCamera(imei, channel, vehicleName) {
  console.log(`[Camera] Opening: ${imei}, channel ${channel}`);

  const modal = document.getElementById("videoModal");
  const player = document.getElementById("videoPlayer");
  const info = document.getElementById("videoInfo");

  // Reset state
  cleanupAllPlayers();
  currentStreamAttempt = 0;
  player.src = "";
  player.style.display = "";
  player.poster = "";

  // Show loading state with spinner
  info.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${vehicleName} - Camera ${channel} (Menghubungkan...)`;
  modal.classList.add("active");

  // Step 1: Check camera source and get stream URLs
  fetch(`/api/video/check/${imei}/${channel}`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data) => {
      console.log("[Camera] Check response:", data);

      if (data.source === "carcentro") {
        // CarCentro: redirect to portal
        player.style.display = "none";
        info.innerHTML = `
          <div style="text-align:center;padding:30px;">
            <i class="fas fa-external-link-alt" style="font-size:36px;color:#0066a1;margin-bottom:15px;display:block;"></i>
            <div style="font-size:16px;font-weight:600;margin-bottom:10px;">${vehicleName} - CCTV</div>
            <div style="font-size:13px;color:#666;margin-bottom:20px;">
              Video streaming tersedia melalui CarCentro (AoooG) portal
            </div>
            <a href="${data.portal_url}" target="_blank" 
               style="display:inline-block;padding:12px 24px;background:#0066a1;color:white;border-radius:8px;text-decoration:none;font-weight:600;">
              <i class="fas fa-external-link-alt"></i> Buka CarCentro Portal
            </a>
          </div>
        `;
        return;
      }

      if (!data.available && !data.is_present) {
        // Show clear offline state
        player.style.display = "none";
        info.innerHTML = `
          <div style="text-align:center;padding:40px;">
            <i class="fas fa-video-slash" style="font-size:48px;color:#666;margin-bottom:15px;display:block;"></i>
            <div style="font-size:16px;font-weight:600;margin-bottom:8px;">${vehicleName} - Camera ${channel}</div>
            <div style="font-size:13px;color:#999;margin-bottom:20px;">
              Camera offline atau tidak tersedia.<br>Pastikan device menyala dan terhubung ke jaringan.
            </div>
            <button onclick="closeVideo(); setTimeout(() => openCamera('${imei}', ${channel}, '${vehicleName}'), 300);"
               style="padding:10px 20px;background:#0066a1;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;">
              <i class="fas fa-redo"></i> Coba Lagi
            </button>
          </div>
        `;
        return;
      }

      // Device available — proceed to stream
      player.style.display = "";
      
      if (data.source === "solofleet") {
        // SoloFleet: WebSocket + JMuxer (H.264 raw)
        streamSoloFleet(imei, channel, vehicleName);
      } else {
        // TGTrack: try the best protocol available
        startTGTrackStream(data, imei, channel, vehicleName);
      }
    })
    .catch((err) => {
      console.error("[Camera] Check error:", err);
      player.style.display = "none";
      info.innerHTML = `
        <div style="text-align:center;padding:40px;">
          <i class="fas fa-exclamation-triangle" style="font-size:48px;color:#ef4444;margin-bottom:15px;display:block;"></i>
          <div style="font-size:16px;font-weight:600;margin-bottom:8px;">${vehicleName} - Camera ${channel}</div>
          <div style="font-size:13px;color:#999;margin-bottom:20px;">
            Gagal terhubung ke server: ${err.message}
          </div>
          <button onclick="closeVideo(); setTimeout(() => openCamera('${imei}', ${channel}, '${vehicleName}'), 300);"
             style="padding:10px 20px;background:#0066a1;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;">
            <i class="fas fa-redo"></i> Coba Lagi
          </button>
        </div>
      `;
    });
}

// ── CarCentro CCTV Handler ──────────────────────────────────
function openCarCentroCCTV(imei, channel, vehicleName, channelName) {
  console.log(`[CarCentro CCTV] Opening: ${vehicleName} - ${channelName} (ch${channel})`);

  const modal = document.getElementById("videoModal");
  const player = document.getElementById("videoPlayer");
  const info = document.getElementById("videoInfo");

  cleanupAllPlayers();
  player.src = "";
  player.style.display = "none";

  info.innerHTML = `
    <div style="text-align:center;padding:30px;">
      <i class="fas fa-video" style="font-size:36px;color:#0066a1;margin-bottom:15px;display:block;"></i>
      <div style="font-size:16px;font-weight:600;margin-bottom:5px;">${vehicleName}</div>
      <div style="font-size:14px;color:#0066a1;margin-bottom:15px;">${channelName} (Channel ${channel})</div>
      <div style="font-size:13px;color:#666;margin-bottom:20px;">
        CCTV streaming untuk bus CarCentro tersedia melalui portal AoooG.<br>
        Klik tombol di bawah untuk membuka portal.
      </div>
      <a href="http://carcentro.aooog.com" target="_blank" 
         style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#0066a1 0%,#003d5c 100%);color:white;border-radius:8px;text-decoration:none;font-weight:600;box-shadow:0 2px 8px rgba(0,102,161,0.3);">
        <i class="fas fa-external-link-alt"></i> Buka CarCentro CCTV
      </a>
    </div>
  `;

  modal.classList.add("active");
}

// ── TGTrack stream strategy ───────────────────────────────
// Priority: 1) HLS/M3U8  2) FLV via mpegts.js  3) HTTP-FLV direct
function startTGTrackStream(streamData, imei, channel, vehicleName) {
  const info = document.getElementById("videoInfo");

  // Priority 1: HLS (M3U8) — best quality, CDN-backed
  if (streamData.m3u8) {
    console.log("[Camera] Trying HLS first:", streamData.m3u8);
    streamHLS(streamData.m3u8, imei, channel, vehicleName, streamData);
    return;
  }

  // Priority 2: FLV via mpegts.js proxy
  if (streamData.http || streamData.ws) {
    console.log("[Camera] No M3U8, trying FLV via mpegts.js");
    streamMpegTS_FLV(imei, channel, vehicleName, streamData);
    return;
  }

  info.textContent = `${vehicleName} - Camera ${channel} (Tidak ada stream URL tersedia)`;
}

// ── HLS Player (M3U8) ────────────────────────────────────
function streamHLS(m3u8Url, imei, channel, vehicleName, streamData) {
  const player = document.getElementById("videoPlayer");
  const info = document.getElementById("videoInfo");

  cleanupAllPlayers();
  info.textContent = `${vehicleName} - Camera ${channel} (Connecting HLS...)`;

  // Safari: native HLS support
  if (player.canPlayType("application/vnd.apple.mpegurl")) {
    console.log("[HLS] Using native Safari HLS");
    player.src = m3u8Url;
    player.muted = true;
    player.setAttribute("playsinline", "");

    const onLoad = () => {
      info.textContent = `${vehicleName} - Camera ${channel} (Live - HLS)`;
      player.removeEventListener("loadedmetadata", onLoad);
    };
    const onError = () => {
      console.error("[HLS] Native HLS failed, falling back to FLV");
      player.removeEventListener("error", onError);
      player.removeEventListener("loadedmetadata", onLoad);
      streamMpegTS_FLV(imei, channel, vehicleName, streamData);
    };

    player.addEventListener("loadedmetadata", onLoad);
    player.addEventListener("error", onError);
    player.play().then(() => {
      setTimeout(() => { player.muted = false; }, 500);
    }).catch(() => {});
    return;
  }

  // Chrome/Firefox: use HLS.js (pre-loaded)
  if (typeof Hls === "undefined" || !Hls.isSupported()) {
    console.warn("[HLS] HLS.js not available, falling back to FLV");
    streamMpegTS_FLV(imei, channel, vehicleName, streamData);
    return;
  }

  console.log("[HLS] Using HLS.js");
  hlsPlayer = new Hls({
    enableWorker: true,
    lowLatencyMode: true,
    backBufferLength: 30,
    maxBufferLength: 10,
    maxMaxBufferLength: 30,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 6,
    // Faster error recovery
    fragLoadingMaxRetry: 3,
    fragLoadingMaxRetryTimeout: 8000,
    manifestLoadingMaxRetry: 3,
    levelLoadingMaxRetry: 3,
  });

  hlsPlayer.loadSource(m3u8Url);
  hlsPlayer.attachMedia(player);

  let hlsTimeout = setTimeout(() => {
    console.warn("[HLS] Timeout - no playback after 15s, falling back to FLV");
    cleanupHLS();
    streamMpegTS_FLV(imei, channel, vehicleName, streamData);
  }, 15000);

  hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
    clearTimeout(hlsTimeout);
    info.textContent = `${vehicleName} - Camera ${channel} (Live - HLS)`;
    player.muted = true;
    player.setAttribute("playsinline", "");
    player.play().then(() => {
      setTimeout(() => { player.muted = false; }, 500);
    }).catch((err) => console.log("[HLS] Autoplay blocked:", err));
  });

  hlsPlayer.on(Hls.Events.ERROR, (event, data) => {
    console.error("[HLS] Error:", data.type, data.details);
    if (data.fatal) {
      clearTimeout(hlsTimeout);

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        console.log("[HLS] Network error, trying recovery once...");
        hlsPlayer.startLoad();
        // If still fails after 5s, fallback
        setTimeout(() => {
          if (hlsPlayer) {
            console.log("[HLS] Recovery failed, falling back to FLV");
            cleanupHLS();
            streamMpegTS_FLV(imei, channel, vehicleName, streamData);
          }
        }, 5000);
      } else {
        console.log("[HLS] Fatal non-network error, falling back to FLV");
        cleanupHLS();
        streamMpegTS_FLV(imei, channel, vehicleName, streamData);
      }
    }
  });
}

// ── mpegts.js FLV Player ──────────────────────────────────
// Replaces flv.js with better error recovery and low-latency support
function streamMpegTS_FLV(imei, channel, vehicleName, streamData) {
  const player = document.getElementById("videoPlayer");
  const info = document.getElementById("videoInfo");

  cleanupMpegTS();

  if (typeof mpegts === "undefined" || !mpegts.isSupported()) {
    console.error("[mpegts] Not supported in this browser");
    info.textContent = `${vehicleName} - Camera ${channel} (Browser tidak support video player)`;
    return;
  }

  // Use WS (WebSocket-FLV) if available, otherwise HTTP-FLV proxy
  let streamUrl;
  let useWebSocket = false;

  if (streamData && streamData.ws) {
    // Direct WebSocket FLV from TGTrack gateway (lowest latency)
    streamUrl = streamData.ws;
    useWebSocket = true;
    console.log("[mpegts] Using WebSocket-FLV:", streamUrl);
  } else {
    // HTTP-FLV via our proxy
    streamUrl = `/api/video/stream/${imei}/${channel}`;
    console.log("[mpegts] Using HTTP-FLV proxy:", streamUrl);
  }

  info.textContent = `${vehicleName} - Camera ${channel} (Connecting FLV...)`;

  try {
    const playerConfig = {
      type: "flv",
      isLive: true,
      hasAudio: false,
      cors: true,
      url: streamUrl,
    };

    // If WebSocket URL, adjust config
    if (useWebSocket) {
      playerConfig.type = "flv";
      playerConfig.url = streamUrl;
    }

    mpegtsPlayer = mpegts.createPlayer(playerConfig, {
      // mpegts.js specific config for low latency
      enableWorker: true,
      enableStashBuffer: false, // Disable stash for lowest latency
      stashInitialSize: 128, // Small initial buffer
      lazyLoad: false,
      autoCleanupSourceBuffer: true,
      autoCleanupMaxBackwardDuration: 5,
      autoCleanupMinBackwardDuration: 3,
      liveBufferLatencyChasing: true, // Chase live edge
      liveBufferLatencyMaxLatency: 3.0, // Max 3s behind live
      liveBufferLatencyMinRemain: 0.5, // Min buffer
    });

    mpegtsPlayer.attachMediaElement(player);
    mpegtsPlayer.load();

    // Timeout: if no data after 20s, retry or fail
    let playbackStarted = false;
    let loadTimeout = setTimeout(() => {
      if (!playbackStarted) {
        console.warn("[mpegts] Timeout - no playback after 20s");
        handleFLVError(imei, channel, vehicleName, "Timeout - tidak ada data");
      }
    }, 20000);

    mpegtsPlayer.on(mpegts.Events.LOADING_COMPLETE, () => {
      console.log("[mpegts] Loading complete (stream ended)");
      info.textContent = `${vehicleName} - Camera ${channel} (Stream berakhir)`;
    });

    mpegtsPlayer.on(mpegts.Events.MEDIA_INFO, (mediaInfo) => {
      console.log("[mpegts] Media info:", mediaInfo);
    });

    mpegtsPlayer.on(mpegts.Events.ERROR, (errorType, errorDetail, errorInfo) => {
      console.error("[mpegts] Error:", errorType, errorDetail, errorInfo);
      clearTimeout(loadTimeout);
      handleFLVError(imei, channel, vehicleName, `${errorType}: ${errorDetail}`);
    });

    // Start playback - always mute first for autoplay policy compliance
    player.muted = true;
    player.setAttribute("playsinline", "");
    player.setAttribute("autoplay", "");
    
    // Use the video element's play(), not mpegtsPlayer.play()
    // mpegts.js feeds data into the video element via MSE
    const tryPlay = () => {
      player.play()
        .then(() => {
          playbackStarted = true;
          clearTimeout(loadTimeout);
          console.log("[mpegts] Playing (muted for autoplay)!");
          info.textContent = `${vehicleName} - Camera ${channel} (Live - FLV)`;
          
          // Try to unmute after a short delay
          setTimeout(() => { player.muted = false; }, 500);
        })
        .catch((err) => {
          console.warn("[mpegts] Play blocked:", err.message);
          clearTimeout(loadTimeout);
          // Show click-to-play overlay
          info.innerHTML = `${vehicleName} - Camera ${channel} <span style="color:#f59e0b;cursor:pointer;text-decoration:underline;" onclick="document.getElementById('videoPlayer').play().then(()=>{document.getElementById('videoInfo').textContent='${vehicleName} - Camera ${channel} (Live - FLV)';}).catch(()=>{});">▶ Klik di sini atau pada video untuk play</span>`;
          
          player.addEventListener(
            "click",
            () => {
              player.muted = true;
              // Re-check if mpegts is still connected, reload if needed
              if (!mpegtsPlayer) {
                // Player was destroyed, re-init
                streamMpegTS_FLV(imei, channel, vehicleName, streamData || {});
                return;
              }
              player.play().then(() => {
                info.textContent = `${vehicleName} - Camera ${channel} (Live - FLV)`;
                setTimeout(() => { player.muted = false; }, 500);
              }).catch(() => {
                // Final fallback: full re-init
                cleanupMpegTS();
                streamMpegTS_FLV(imei, channel, vehicleName, streamData || {});
              });
            },
            { once: true }
          );
        });
    };

    // Small delay to let mpegts buffer some data before play attempt
    setTimeout(tryPlay, 500);
  } catch (err) {
    console.error("[mpegts] Init error:", err);
    info.textContent = `${vehicleName} - Camera ${channel} (Init Error: ${err.message})`;
  }
}

// ── FLV Error handler with retry logic ────────────────────
function handleFLVError(imei, channel, vehicleName, errorMsg) {
  const info = document.getElementById("videoInfo");
  const player = document.getElementById("videoPlayer");

  currentStreamAttempt++;

  if (currentStreamAttempt <= MAX_STREAM_RETRIES) {
    console.log(`[mpegts] Retry attempt ${currentStreamAttempt}/${MAX_STREAM_RETRIES}`);
    info.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${vehicleName} - Camera ${channel} (Reconnecting... ${currentStreamAttempt}/${MAX_STREAM_RETRIES})`;

    cleanupMpegTS();

    // Wait before retry (exponential backoff)
    setTimeout(() => {
      // Re-fetch stream info for fresh URLs
      fetch(`/api/video/check/${imei}/${channel}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.available || data.is_present) {
            streamMpegTS_FLV(imei, channel, vehicleName, data);
          } else {
            player.style.display = "none";
            info.innerHTML = `
              <div style="text-align:center;padding:40px;">
                <i class="fas fa-video-slash" style="font-size:48px;color:#666;margin-bottom:15px;display:block;"></i>
                <div style="font-size:16px;font-weight:600;margin-bottom:8px;">${vehicleName} - Camera ${channel}</div>
                <div style="font-size:13px;color:#999;margin-bottom:20px;">Camera offline</div>
                <button onclick="closeVideo(); setTimeout(() => openCamera('${imei}', ${channel}, '${vehicleName}'), 300);"
                   style="padding:10px 20px;background:#0066a1;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;">
                  <i class="fas fa-redo"></i> Coba Lagi
                </button>
              </div>
            `;
          }
        })
        .catch(() => {
          // Last resort: try proxy without fresh URLs
          streamMpegTS_FLV(imei, channel, vehicleName, {});
        });
    }, 2000 * currentStreamAttempt);
  } else {
    // All retries exhausted — show clear failure UI with retry button
    player.style.display = "none";
    info.innerHTML = `
      <div style="text-align:center;padding:40px;">
        <i class="fas fa-exclamation-circle" style="font-size:48px;color:#ef4444;margin-bottom:15px;display:block;"></i>
        <div style="font-size:16px;font-weight:600;margin-bottom:8px;">${vehicleName} - Camera ${channel}</div>
        <div style="font-size:13px;color:#999;margin-bottom:5px;">Gagal terhubung setelah ${MAX_STREAM_RETRIES}x percobaan</div>
        <div style="font-size:11px;color:#666;margin-bottom:20px;">${errorMsg}</div>
        <button onclick="currentStreamAttempt=0; closeVideo(); setTimeout(() => openCamera('${imei}', ${channel}, '${vehicleName}'), 300);"
           style="padding:10px 20px;background:#0066a1;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;">
          <i class="fas fa-redo"></i> Coba Lagi
        </button>
      </div>
    `;
  }
}

// ── SoloFleet stream (WebSocket + JMuxer) ─────────────────
function streamSoloFleet(imei, channel, vehicleName) {
  const player = document.getElementById("videoPlayer");
  const info = document.getElementById("videoInfo");

  cleanupSoloFleetStream();
  info.textContent = `${vehicleName} - Camera ${channel} (Connecting SoloFleet...)`;

  if (typeof JMuxer === "undefined") {
    info.textContent = `${vehicleName} - Camera ${channel} (JMuxer not loaded)`;
    return;
  }

  initSoloFleetStream(imei, channel, vehicleName);
}

function initSoloFleetStream(imei, channel, vehicleName) {
  const player = document.getElementById("videoPlayer");
  const info = document.getElementById("videoInfo");

  try {
    sfJmuxer = new JMuxer({
      node: "videoPlayer",
      mode: "video",
      flushingTime: 1000,
      clearBuffer: true,
      fps: 15,
      debug: false,
      onError: function (data) {
        console.error("[SoloFleet] JMuxer error:", data);
      },
    });

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/video/sf-stream/${imei}/${channel}`;
    console.log("[SoloFleet] WS URL:", wsUrl);

    sfWebSocket = new WebSocket(wsUrl);
    sfWebSocket.binaryType = "arraybuffer";

    let framesReceived = 0;

    // Timeout if no frames after 15s
    let sfTimeout = setTimeout(() => {
      if (framesReceived === 0) {
        info.textContent = `${vehicleName} - Camera ${channel} (DVR tidak merespons - mungkin offline)`;
      }
    }, 15000);

    sfWebSocket.onopen = () => {
      console.log("[SoloFleet] WS connected");
      info.textContent = `${vehicleName} - Camera ${channel} (Waiting for DVR stream...)`;
    };

    sfWebSocket.onmessage = (event) => {
      framesReceived++;
      const data = new Uint8Array(event.data);

      sfJmuxer.feed({ video: data });

      if (framesReceived === 1) {
        clearTimeout(sfTimeout);
        info.textContent = `${vehicleName} - Camera ${channel} (Live - SoloFleet)`;
        player.play().catch(() => {});
      }

      if (framesReceived % 100 === 0) {
        console.log(`[SoloFleet] ${framesReceived} frames received`);
      }
    };

    sfWebSocket.onerror = (err) => {
      clearTimeout(sfTimeout);
      console.error("[SoloFleet] WS error:", err);
      info.textContent = `${vehicleName} - Camera ${channel} (Connection Error)`;
    };

    sfWebSocket.onclose = (event) => {
      clearTimeout(sfTimeout);
      console.log("[SoloFleet] WS closed:", event.code, event.reason);
      if (framesReceived === 0) {
        info.textContent = `${vehicleName} - Camera ${channel} (Stream Unavailable - DVR offline)`;
      }
    };
  } catch (err) {
    console.error("[SoloFleet] Init error:", err);
    info.textContent = `${vehicleName} - Camera ${channel} (Init Error)`;
  }
}

// ── Cleanup functions ─────────────────────────────────────
function cleanupHLS() {
  if (hlsPlayer) {
    try {
      hlsPlayer.destroy();
    } catch (e) {}
    hlsPlayer = null;
  }
}

function cleanupMpegTS() {
  if (mpegtsPlayer) {
    try {
      mpegtsPlayer.pause();
      mpegtsPlayer.unload();
      mpegtsPlayer.detachMediaElement();
      mpegtsPlayer.destroy();
    } catch (e) {}
    mpegtsPlayer = null;
  }
}

function cleanupSoloFleetStream() {
  if (sfWebSocket) {
    try {
      sfWebSocket.close();
    } catch (e) {}
    sfWebSocket = null;
  }
  if (sfJmuxer) {
    try {
      sfJmuxer.destroy();
    } catch (e) {}
    sfJmuxer = null;
  }
}

function cleanupAllPlayers() {
  cleanupHLS();
  cleanupMpegTS();
  cleanupSoloFleetStream();

  // Also reset the video element
  const player = document.getElementById("videoPlayer");
  if (player) {
    player.pause();
    player.removeAttribute("src");
    player.load(); // Reset media element
  }
}

// ── Close video modal ─────────────────────────────────────
function closeVideo() {
  const modal = document.getElementById("videoModal");
  const player = document.getElementById("videoPlayer");
  cleanupAllPlayers();
  currentStreamAttempt = 0;
  // Restore video player visibility (may be hidden by CarCentro CCTV modal)
  if (player) player.style.display = "";
  modal.classList.remove("active");
}

// Close modals on Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeVehicleModal();
    closeVideo();
    closeImage(); // Add close image
  }
});

// Add backdrop click for image modal
document.addEventListener("DOMContentLoaded", () => {
  const videoModal = document.getElementById("videoModal");
  const imageModal = document.getElementById("imageModal");
  const vehicleModal = document.getElementById("vehicleModal");

  if (videoModal) {
    videoModal.addEventListener("click", (e) => {
      if (e.target === videoModal) {
        closeVideo();
      }
    });
  }

  if (imageModal) {
    imageModal.addEventListener("click", (e) => {
      if (e.target === imageModal) {
        closeImage();
      }
    });
  }

  if (vehicleModal) {
    vehicleModal.addEventListener("click", (e) => {
      if (e.target === vehicleModal) {
        closeVehicleModal();
      }
    });
  }
});