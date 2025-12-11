// Command Center JavaScript
let map;
let markers = [];
let selectedVehicle = null;
let vehiclesData = [];
let currentAlarmTab = "all";
let flvPlayer = null;

// ✅ Missing function
function closeVehicleModal() {
  const modal = document.getElementById("vehicleModal");
  if (modal) {
    modal.classList.remove("active");
  }
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  // console.log("✅ FLV.js version:", typeof flvjs !== "undefined" ? flvjs.version : "NOT LOADED");

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

// Render vehicle grid
function renderVehicleGrid() {
  const grid = document.getElementById("vehicleGrid");

  grid.innerHTML = vehiclesData
    .map((vehicle) => {
      const scoreClass = vehicle.safety_score >= 80 ? "" : vehicle.safety_score >= 60 ? "warning" : "danger";
      const isSelected = selectedVehicle === vehicle.vehicle_name;

      return `
      <div class="vehicle-card ${isSelected ? "selected" : ""}" 
           onclick="selectVehicle('${vehicle.vehicle_name}')">
        <div class="vehicle-card-header">
          <div class="vehicle-avatar">
            <i class="fas fa-truck"></i>
          </div>
          <div class="vehicle-title">
            <h4>${vehicle.vehicle_name}</h4>
            <div class="vehicle-status">
              <span class="status-dot"></span>
              ${vehicle.location ? "Online" : "Offline"}
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
  cameraGrid.innerHTML = Array.from(
    { length: 8 },
    (_, i) => `
    <button class="camera-btn-modal" onclick="openCamera('${imei}', ${i + 1}, '${vehicleName}')">
      <i class="fas fa-video"></i> Camera ${i + 1}
    </button>
  `
  ).join("");

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

  // Stop FLV player if active
  if (flvPlayer) {
    try {
      flvPlayer.pause();
      flvPlayer.unload();
      flvPlayer.detachMediaElement();
      flvPlayer.destroy();
      flvPlayer = null;
    } catch (err) {
      console.error("Error destroying FLV player:", err);
    }
  }

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

function openCamera(imei, channel, vehicleName) {
  console.log(`Opening camera: ${imei}, channel ${channel}`);

  const modal = document.getElementById("videoModal");
  const player = document.getElementById("videoPlayer");
  const info = document.getElementById("videoInfo");

  info.textContent = `${vehicleName} - Camera ${channel} (Loading...)`;
  modal.classList.add("active");

  // Check FLV support
  if (typeof flvjs === "undefined" || !flvjs.isSupported()) {
    console.error("FLV.js not supported");
    info.textContent = `${vehicleName} - Camera ${channel} (Player not supported)`;
    return;
  }

  streamFLV(imei, channel, vehicleName);
}

// Stream FLV video
function streamFLV(imei, channel, vehicleName) {
  const player = document.getElementById("videoPlayer");
  const info = document.getElementById("videoInfo");

  // Destroy previous player
  if (flvPlayer) {
    try {
      flvPlayer.pause();
      flvPlayer.unload();
      flvPlayer.detachMediaElement();
      flvPlayer.destroy();
      flvPlayer = null;
    } catch (err) {
      console.error("Error destroying previous player:", err);
    }
  }

  const streamUrl = `/api/video/stream/${imei}/${channel}`;
  console.log("Stream URL:", streamUrl);

  info.textContent = `${vehicleName} - Camera ${channel} (Connecting...)`;

  try {
    flvPlayer = flvjs.createPlayer({
      type: "flv",
      url: streamUrl,
      isLive: true,
      hasAudio: false,
      cors: true,
    });

    flvPlayer.attachMediaElement(player);
    flvPlayer.load();

    flvPlayer.on(flvjs.Events.ERROR, (errorType, errorDetail) => {
      console.error("FLV Error:", errorType, errorDetail);
      info.textContent = `${vehicleName} - Camera ${channel} (Error: ${errorDetail})`;
    });

    flvPlayer
      .play()
      .then(() => {
        console.log("Playing");
        info.textContent = `${vehicleName} - Camera ${channel} (Live)`;
      })
      .catch((err) => {
        console.error("Play error:", err);
        info.textContent = `${vehicleName} - Camera ${channel} (Playback Error)`;
      });
  } catch (err) {
    console.error("FLV init error:", err);
    info.textContent = `${vehicleName} - Camera ${channel} (Init Error)`;
  }
}

// Update close video function
function closeVideo() {
  const modal = document.getElementById("videoModal");
  const player = document.getElementById("videoPlayer");

  if (flvPlayer) {
    try {
      flvPlayer.pause();
      flvPlayer.unload();
      flvPlayer.detachMediaElement();
      flvPlayer.destroy();
      flvPlayer = null;
    } catch (err) {
      console.error("Error destroying player:", err);
    }
  }

  player.pause();
  player.src = "";
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
