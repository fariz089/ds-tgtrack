// public/js/dashboard.js

// Global variables
let map;
let alarmMarkers = [];

// Filter state
let currentFilterMode = "preset";
let currentHours = 1;

// ========== FILTER FUNCTIONS ==========

// Toggle custom date range
function toggleCustomRange() {
  const customSection = document.getElementById("customRangeSection");
  const isVisible = customSection.style.display !== "none";

  if (isVisible) {
    // Tutup custom range, balik ke preset
    customSection.style.display = "none";
    currentFilterMode = "preset";

    // Aktifkan lagi preset button
    document.querySelectorAll(".preset-btn").forEach((btn) => {
      if (btn.dataset.hours == currentHours) {
        btn.classList.add("active");
      } else if (!btn.dataset.custom) {
        btn.classList.remove("active");
      }
    });
  } else {
    // Buka custom range
    customSection.style.display = "block";
    currentFilterMode = "custom";

    // Default: kemarin sampai sekarang
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    document.getElementById("safetyEnd").value = formatDateTimeLocal(now);
    document.getElementById("safetyStart").value = formatDateTimeLocal(yesterday);

    // Aktifkan custom button
    document.querySelectorAll(".preset-btn").forEach((btn) => {
      if (btn.dataset.custom) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }
}

// Pilih preset waktu
function selectPreset(hours) {
  if (hours === "custom") {
    toggleCustomRange();
    return;
  }

  currentHours = hours;
  currentFilterMode = "preset";

  // Tutup custom range
  const customSection = document.getElementById("customRangeSection");
  if (customSection) {
    customSection.style.display = "none";
  }

  // Update button active
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    if (btn.dataset.hours == hours) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  updateFilterInfo();
  applySafetyFilter();
}

// Format Date ke datetime-local input
function formatDateTimeLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Update filter status text
function updateFilterInfo() {
  const filterText = document.getElementById("filterStatusText");
  if (!filterText) return;

  if (currentFilterMode === "preset") {
    const hoursText =
      currentHours < 24
        ? `Last ${currentHours} hour${currentHours > 1 ? "s" : ""}`
        : currentHours === 24
        ? "Last 24 hours"
        : `Last ${currentHours / 24} days`;
    filterText.textContent = `Showing: ${hoursText}`;
  } else {
    const start = document.getElementById("safetyStart")?.value;
    const end = document.getElementById("safetyEnd")?.value;

    if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      filterText.textContent = `Custom: ${startDate.toLocaleString("id-ID")} → ${endDate.toLocaleString("id-ID")}`;
    } else {
      filterText.textContent = "Custom range selected";
    }
  }
}

// Build query params
function buildQueryParams() {
  const params = new URLSearchParams();

  if (currentFilterMode === "preset") {
    params.append("hours", currentHours);
  } else {
    const startDate = document.getElementById("safetyStart")?.value;
    const endDate = document.getElementById("safetyEnd")?.value;
    if (startDate && endDate) {
      params.append("startDate", new Date(startDate).toISOString());
      params.append("endDate", new Date(endDate).toISOString());
    }
  }
  return params;
}

// Apply filter
async function applySafetyFilter() {
  // Validasi custom date
  if (currentFilterMode === "custom") {
    const startDate = document.getElementById("safetyStart")?.value;
    const endDate = document.getElementById("safetyEnd")?.value;
    if (!startDate || !endDate) {
      alert("Please select both start and end dates");
      return;
    }
  }

  updateFilterInfo();

  // Reload semua data
  await Promise.all([
    loadSafetyScores(),
    loadRiskyVehicles(),
    loadCoordinateSummary(),
    loadAlarmMarkers(), // Reload alarm markers di map
  ]);
}

// Reset filter
function resetFilters() {
  selectPreset(1);
}

// ========== SAFETY SCORE FUNCTIONS ==========

// Load fleet safety score
async function loadSafetyScores() {
  try {
    const query = buildQueryParams();
    const fleetResponse = await fetch(`/api/safety/fleet-score?${query}`);
    const fleetScore = await fleetResponse.json();
    updateFleetScore(fleetScore);
  } catch (err) {
    console.error("Error loading safety scores:", err);
  }
}

// Load risky vehicles
async function loadRiskyVehicles() {
  try {
    const query = buildQueryParams();
    query.append("limit", "5");

    const riskyResponse = await fetch(`/api/safety/risky-vehicles?${query}`);
    const riskyVehicles = await riskyResponse.json();
    updateRiskyVehicles(riskyVehicles);
  } catch (err) {
    console.error("Error loading risky vehicles:", err);
  }
}

// Load coordinate summary buat table
async function loadCoordinateSummary() {
  try {
    const query = buildQueryParams();
    const response = await fetch(`/api/coordinates/summary?${query}`);
    const summaryData = await response.json();
    updateSummaryTable(summaryData);
  } catch (err) {
    console.error("Error loading coordinate summary:", err);
  }
}

// Update UI fleet score
function updateFleetScore(data) {
  document.getElementById("fleetScoreValue").textContent = data.score;
  document.getElementById("fleetScoreValue").style.color = data.grade.color;

  const gradeElement = document.getElementById("fleetScoreGrade");
  gradeElement.textContent = data.grade.letter;
  gradeElement.style.background = data.grade.color + "20";
  gradeElement.style.color = data.grade.color;

  document.getElementById("fleetScoreLabel").textContent = data.grade.label;
  document.getElementById("fleetTotalAlarms").textContent = data.total_alarms;
  document.getElementById("fleetCritical").textContent = data.severity_counts.critical;
  document.getElementById("fleetADAS").textContent = data.category_breakdown.ADAS;
  document.getElementById("fleetDSM").textContent = data.category_breakdown.DSM;

  document.getElementById("activeVehicles").textContent = data.total_vehicles;
  document.getElementById("adasCount").textContent = data.category_breakdown.ADAS;
  document.getElementById("dsmCount").textContent = data.category_breakdown.DSM;
}

// Update risky vehicles list
function updateRiskyVehicles(vehicles) {
  const container = document.getElementById("riskyVehiclesList");

  if (vehicles.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #22c55e;">
        <i class="fas fa-check-circle" style="font-size: 48px; margin-bottom: 15px;"></i>
        <div style="font-weight: 600; font-size: 16px;">Excellent Performance!</div>
        <div style="font-size: 13px; margin-top: 5px;">No risky vehicles detected</div>
      </div>
    `;
    return;
  }

  container.innerHTML = vehicles
    .map(
      (v, index) => `
        <div class="risky-vehicle-item" style="border-left-color: ${v.grade.color}; cursor: pointer;" 
             onclick="showVehicleAlarms('${v.vehicle_name}')">
            <div class="risky-vehicle-info">
                <div class="risky-vehicle-rank" style="color: ${v.grade.color};">
                    ${index + 1}
                </div>
                <div>
                    <div class="risky-vehicle-name">${v.vehicle_name}</div>
                    <div class="risky-vehicle-alarms">
                        ${v.alarm_count} alarms 
                        ${
                          v.severity_counts.critical > 0
                            ? `• <span style="color: #ef4444;">${v.severity_counts.critical} critical</span>`
                            : ""
                        }
                    </div>
                </div>
            </div>
            <div class="risky-vehicle-score">
                <div class="risky-score-value" style="color: ${v.grade.color};">
                    ${v.score}
                </div>
                <div class="risky-score-grade" style="background: ${v.grade.color}20; color: ${v.grade.color};">
                    ${v.grade.letter}
                </div>
            </div>
        </div>
    `
    )
    .join("");
}

// Update summary table
function updateSummaryTable(summaryData) {
  const tbody = document.getElementById("fleetTableBody");

  if (!summaryData || summaryData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px;">No data available</td></tr>';
    return;
  }

  tbody.innerHTML = summaryData
    .map((vehicle) => {
      return `
        <tr class="vehicle-row">
            <td><strong>${vehicle.vehicle_name}</strong></td>
            <td>${vehicle.avg_speed.toFixed(1)} km/h</td>
            <td>${vehicle.mileage_diff.toFixed(1)} km</td>
            <td>
                <i class="fas fa-satellite"></i> ${vehicle.avg_satellites.toFixed(0)} sats
            </td>
            <td>
                <button class="btn-icon" onclick="showVehicleAlarms('${vehicle.vehicle_name}')" title="View Alarms">
                    <i class="fas fa-exclamation-triangle"></i> Alarms
                </button>
            </td>
        </tr>
    `;
    })
    .join("");
}

// ========== MAP FUNCTIONS (ALARM LOCATIONS ONLY) ==========

// Initialize Google Maps
function initMap() {
  const defaultCenter = { lat: -7.5, lng: 112.5 }; // Jawa Timur center

  map = new google.maps.Map(document.getElementById("map"), {
    zoom: 8,
    center: defaultCenter,
    mapTypeId: "roadmap",
    styles: [
      {
        featureType: "poi",
        elementType: "labels",
        stylers: [{ visibility: "off" }],
      },
    ],
  });
}

// Load alarm markers (ADAS & DSM) berdasarkan filter
async function loadAlarmMarkers() {
  try {
    // Clear existing markers
    alarmMarkers.forEach((marker) => marker.setMap(null));
    alarmMarkers = [];

    // ✅ Pakai query params dari filter
    const query = buildQueryParams();
    query.append("limit", "100");

    console.log("📍 Loading alarm markers with filter:", query.toString());

    // Fetch ADAS & DSM alarms
    const [adasResponse, dsmResponse] = await Promise.all([
      fetch(`/api/adas?${query}`),
      fetch(`/api/dsm?${query}`)
    ]);

    const adasAlarms = await adasResponse.json();
    const dsmAlarms = await dsmResponse.json();

    const bounds = new google.maps.LatLngBounds();
    let hasMarkers = false;

    // ADAS markers
    adasAlarms.forEach((alarm) => {
      if (alarm.lat && alarm.lng) {
        const marker = new google.maps.Marker({
          position: { lat: alarm.lat, lng: alarm.lng },
          map: map,
          title: `ADAS: ${alarm.alarm_type}`,
          icon: {
            path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: 6,
            fillColor: "#ef4444",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
            rotation: 0,
          },
          zIndex: 1000,
        });

        const infoWindow = new google.maps.InfoWindow({
          content: getAlarmInfoWindowContent(alarm, "ADAS"),
        });

        marker.addListener("click", () => {
          infoWindow.open(map, marker);
        });

        alarmMarkers.push(marker);
        bounds.extend(marker.getPosition());
        hasMarkers = true;
      }
    });

    // DSM markers
    dsmAlarms.forEach((alarm) => {
      if (alarm.lat && alarm.lng) {
        const marker = new google.maps.Marker({
          position: { lat: alarm.lat, lng: alarm.lng },
          map: map,
          title: `DSM: ${alarm.alarm_type}`,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#f59e0b",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
          zIndex: 1000,
        });

        const infoWindow = new google.maps.InfoWindow({
          content: getAlarmInfoWindowContent(alarm, "DSM"),
        });

        marker.addListener("click", () => {
          infoWindow.open(map, marker);
        });

        alarmMarkers.push(marker);
        bounds.extend(marker.getPosition());
        hasMarkers = true;
      }
    });

    // Fit map ke bounds kalau ada markers
    if (hasMarkers) {
      map.fitBounds(bounds);
    }

    console.log(`✓ Loaded ${adasAlarms.length} ADAS + ${dsmAlarms.length} DSM alarm markers`);
  } catch (err) {
    console.error("Error loading alarm markers:", err);
  }
}


// Toggle visibility alarm markers
function toggleAlarmType(type) {
  const checkbox = document.getElementById(`toggle${type}`);
  if (!checkbox) return;

  alarmMarkers.forEach((marker) => {
    const title = marker.getTitle();
    if (title.startsWith(type)) {
      marker.setVisible(checkbox.checked);
    }
  });
}

// Info window content untuk alarm marker
function getAlarmInfoWindowContent(alarm, type) {
  const eventTime = new Date(alarm.event_time).toLocaleString("id-ID");
  const bgColor = type === "ADAS" ? "#ef4444" : "#f59e0b";

  return `
    <div style="padding: 12px; min-width: 280px; font-family: system-ui;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
        <div style="background: ${bgColor}; color: white; padding: 4px 12px; border-radius: 4px; font-weight: 600; font-size: 13px;">
          ${type}
        </div>
        <div style="color: #666; font-size: 12px;">${eventTime}</div>
      </div>
      
      <div style="margin-bottom: 10px;">
        <div style="font-weight: 600; color: #333; font-size: 15px; margin-bottom: 5px;">
          ${alarm.vehicle_name}
        </div>
        <div style="color: #555; font-size: 14px;">
          ${alarm.alarm_type}
        </div>
      </div>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px; color: #666;">
        <div>
          <i class="fas fa-tachometer-alt" style="color: ${bgColor}; margin-right: 5px;"></i>
          <strong>${alarm.speed}</strong> km/h
        </div>
        <div>
          <i class="fas fa-map-marker-alt" style="color: ${bgColor}; margin-right: 5px;"></i>
          ${alarm.lat.toFixed(4)}, ${alarm.lng.toFixed(4)}
        </div>
      </div>
      
      ${
        alarm.files && alarm.files.length > 0
          ? `
        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e0e0e0;">
          <div style="color: #4CAF50; font-size: 12px;">
            <i class="fas fa-paperclip"></i> ${alarm.files.length} file(s) available
          </div>
        </div>
      `
          : ""
      }
      
      <div style="margin-top: 12px;">
        <button onclick="showVehicleAlarms('${alarm.vehicle_name}')" 
                style="background: ${bgColor}; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; width: 100%;">
          <i class="fas fa-list"></i> View All Alarms
        </button>
      </div>
    </div>
  `;
}

// ========== ALARM MODAL FUNCTIONS ==========

// Show vehicle alarms modal
async function showVehicleAlarms(vehicleName) {
  try {
    const query = buildQueryParams();
    query.append("limit", "20");

    const response = await fetch(`/api/alarms/by-vehicle/${encodeURIComponent(vehicleName)}?${query}`);
    const data = await response.json();
    displayAlarmModal(data);
  } catch (err) {
    console.error("Error loading vehicle alarms:", err);
    alert("Failed to load alarms");
  }
}

// Display alarm modal
function displayAlarmModal(data) {
  const modalHtml = `
    <div class="alarm-modal" id="alarm-modal" onclick="if(event.target.className === 'alarm-modal') closeAlarmModal()">
      <div class="alarm-modal-content">
        <div class="alarm-modal-header">
          <h3>${data.vehicle_name} - Alarm Details</h3>
          <span class="close-modal" onclick="closeAlarmModal()">&times;</span>
        </div>
        <div class="alarm-modal-body">
          <p class="period-info">Period: ${data.period} | Total: ${data.total} alarms</p>
          <div class="alarm-list">
            ${
              data.alarms.length === 0
                ? '<p style="text-align:center;color:#999;padding:20px;">No alarms in this period</p>'
                : data.alarms
                    .map(
                      (alarm) => `
              <div class="alarm-item">
                <div class="alarm-header">
                  <span class="alarm-type">${alarm.alarm_type}</span>
                  <span class="alarm-time">${new Date(alarm.event_time).toLocaleString("id-ID")}</span>
                </div>
                <div class="alarm-details">
                  <span><i class="fas fa-tachometer-alt"></i> ${alarm.speed} km/h</span>
                  <span><i class="fas fa-map-marker-alt"></i> ${alarm.lat?.toFixed(6)}, ${alarm.lng?.toFixed(6)}</span>
                </div>
                ${
                  alarm.files && alarm.files.length > 0
                    ? `
                  <div class="alarm-files-section">
                    <div class="alarm-files-header" onclick="toggleFiles('${alarm._id}')">
                      <span><i class="fas fa-paperclip"></i> ${alarm.files.length} file(s) available</span>
                      <i class="fas fa-chevron-down" id="chevron-${alarm._id}"></i>
                    </div>
                    <div class="alarm-files-list" id="files-${alarm._id}" style="display: none;">
                      ${renderFilesList(alarm.files)}
                    </div>
                  </div>
                `
                    : ""
                }
              </div>
            `
                    )
                    .join("")
            }
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", modalHtml);
}

// ========== FILE VIEWER FUNCTIONS ==========

// Toggle file list visibility
function toggleFiles(alarmId) {
  const filesList = document.getElementById(`files-${alarmId}`);
  const chevron = document.getElementById(`chevron-${alarmId}`);

  if (filesList.style.display === "none") {
    filesList.style.display = "block";
    chevron.style.transform = "rotate(180deg)";
  } else {
    filesList.style.display = "none";
    chevron.style.transform = "rotate(0deg)";
  }
}

// Get icon berdasarkan file type
function getFileIcon(fileType) {
  const icons = {
    1: "fa-image",
    2: "fa-video",
    3: "fa-file-audio",
  };
  return icons[fileType] || "fa-file";
}

// Format file size
function formatFileSize(bytes) {
  if (!bytes) return "Unknown";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

// Check apakah file adalah image
function isImage(file) {
  if (file.file_type === 1) return true;
  const ext = file.file_name?.toLowerCase() || file.relative_path?.toLowerCase() || "";
  return (
    ext.endsWith(".jpg") ||
    ext.endsWith(".jpeg") ||
    ext.endsWith(".png") ||
    ext.endsWith(".gif") ||
    ext.endsWith(".bmp") ||
    ext.endsWith(".webp")
  );
}

// Check apakah file adalah video
function isVideo(file) {
  if (file.file_type === 2) return true;
  const ext = file.file_name?.toLowerCase() || file.relative_path?.toLowerCase() || "";
  return (
    ext.endsWith(".mp4") ||
    ext.endsWith(".avi") ||
    ext.endsWith(".mov") ||
    ext.endsWith(".wmv") ||
    ext.endsWith(".flv") ||
    ext.endsWith(".mkv")
  );
}

// Get file URL
function getFileUrl(relativePath) {
  if (!relativePath) return "";
  if (relativePath.startsWith("http://") || relativePath.startsWith("https://")) {
    return relativePath;
  }
  return relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
}

// Render files list dengan preview
function renderFilesList(files) {
  const images = files.filter((f) => isImage(f));
  const videos = files.filter((f) => isVideo(f));

  // Kalau gak ada image & video, hide
  if (images.length === 0 && videos.length === 0) {
    return '<div style="text-align:center; padding:20px; color:#999;">No media files available</div>';
  }

  let html = "";

  // Image thumbnails
  if (images.length > 0) {
    html += `
      <div class="file-section">
        <div class="file-section-title"><i class="fas fa-images"></i> Images (${images.length})</div>
        <div class="image-grid">
          ${images
            .map((file, idx) => {
              const fileUrl = getFileUrl(file.relative_path);
              return `
              <div class="image-thumb" onclick="viewFile('${fileUrl}', 'image')">
                <img src="${fileUrl}" alt="Image ${idx + 1}" loading="lazy" 
                     onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=padding:10px;text-align:center;color:#999>❌ Failed</div>'">
                <div class="image-overlay">
                  <i class="fas fa-search-plus"></i>
                </div>
              </div>
            `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  // Videos
  if (videos.length > 0) {
    html += `
      <div class="file-section">
        <div class="file-section-title"><i class="fas fa-video"></i> Videos (${videos.length})</div>
        ${videos
          .map((file, idx) => {
            const fileUrl = getFileUrl(file.relative_path);
            return `
            <div class="file-item">
              <div class="file-info">
                <i class="fas fa-video"></i>
                <span class="file-name">${file.file_name || `Video ${idx + 1}`}</span>
                <span class="file-size">(${formatFileSize(file.file_size)})</span>
              </div>
              <div class="file-actions">
                <button class="btn-view" onclick="viewFile('${fileUrl}', 'video')" title="Play">
                  <i class="fas fa-play"></i>
                </button>
                <a href="${fileUrl}" target="_blank" class="btn-download" title="Download">
                  <i class="fas fa-download"></i>
                </a>
              </div>
            </div>
          `;
          })
          .join("")}
      </div>
    `;
  }

  return html;
}

// View file (image atau video) di modal
function viewFile(filePath, fileType) {
  if (fileType === "image") {
    // Image viewer fullscreen
    const imageModal = `
      <div class="file-viewer-modal" onclick="if(event.target.className === 'file-viewer-modal') this.remove()">
        <div class="file-viewer-content">
          <span class="close-viewer" onclick="this.parentElement.parentElement.remove()">&times;</span>
          <img src="${filePath}" style="max-width: 90vw; max-height: 90vh; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
          <div class="image-actions">
            <a href="${filePath}" download class="btn-download-viewer">
              <i class="fas fa-download"></i> Download
            </a>
            <a href="${filePath}" target="_blank" class="btn-open-viewer">
              <i class="fas fa-external-link-alt"></i> Open in New Tab
            </a>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML("beforeend", imageModal);
  } else if (fileType === "video") {
    // Video player fullscreen
    const videoModal = `
      <div class="file-viewer-modal" onclick="if(event.target.className === 'file-viewer-modal') this.remove()">
        <div class="file-viewer-content">
          <span class="close-viewer" onclick="this.parentElement.parentElement.remove()">&times;</span>
          <video controls autoplay style="max-width: 90vw; max-height: 90vh; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
            <source src="${filePath}" type="video/mp4">
            <source src="${filePath}" type="video/webm">
            <source src="${filePath}" type="video/ogg">
            Your browser does not support the video tag.
          </video>
          <div class="image-actions">
            <a href="${filePath}" download class="btn-download-viewer">
              <i class="fas fa-download"></i> Download
            </a>
            <a href="${filePath}" target="_blank" class="btn-open-viewer">
              <i class="fas fa-external-link-alt"></i> Open in New Tab
            </a>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML("beforeend", videoModal);
  }
}

// Close alarm modal
function closeAlarmModal() {
  const modal = document.getElementById("alarm-modal");
  if (modal) modal.remove();
}

// ========== INITIALIZATION ==========

// Init on page load
document.addEventListener("DOMContentLoaded", function () {
  // selectPreset(1);
});
