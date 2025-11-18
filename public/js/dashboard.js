let map;
let markers = {};
let infoWindows = {};
let selectedVehicle = null;

// Load safety scores on page load
document.addEventListener("DOMContentLoaded", function () {
  loadSafetyScores();

  // Auto refresh safety scores every 1 minute
  setInterval(loadSafetyScores, 60000);
});

async function loadSafetyScores() {
  try {
    // Load fleet score
    const fleetResponse = await fetch("/api/safety/fleet-score?hours=1");
    const fleetScore = await fleetResponse.json();

    updateFleetScore(fleetScore);

    // Load risky vehicles
    const riskyResponse = await fetch("/api/safety/risky-vehicles?hours=1&limit=5");
    const riskyVehicles = await riskyResponse.json();

    updateRiskyVehicles(riskyVehicles);
  } catch (err) {
    console.error("Error loading safety scores:", err);
  }
}

function updateFleetScore(data) {
  // Update score value
  document.getElementById("fleetScoreValue").textContent = data.score;
  document.getElementById("fleetScoreValue").style.color = data.grade.color;

  // Update grade badge
  const gradeElement = document.getElementById("fleetScoreGrade");
  gradeElement.textContent = data.grade.letter;
  gradeElement.style.background = data.grade.color + "20";
  gradeElement.style.color = data.grade.color;

  // Update label
  document.getElementById("fleetScoreLabel").textContent = data.grade.label;

  // Update details
  document.getElementById("fleetTotalAlarms").textContent = data.total_alarms;
  document.getElementById("fleetCritical").textContent = data.severity_counts.critical;
  document.getElementById("fleetADAS").textContent = data.category_breakdown.ADAS;
  document.getElementById("fleetDSM").textContent = data.category_breakdown.DSM;

  // Update separate cards
  document.getElementById("activeVehicles").textContent = data.total_vehicles;
  document.getElementById("adasCount").textContent = data.category_breakdown.ADAS;
  document.getElementById("dsmCount").textContent = data.category_breakdown.DSM;
}

// Tambahkan onclick di updateRiskyVehicles
function updateRiskyVehicles(vehicles) {
  const container = document.getElementById("riskyVehiclesList");

  if (vehicles.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #22c55e;">
        <i class="fas fa-check-circle" style="font-size: 48px; margin-bottom: 15px;"></i>
        <div style="font-weight: 600; font-size: 16px;">Excellent Performance!</div>
        <div style="font-size: 13px; margin-top: 5px;">No risky vehicles in the last hour</div>
      </div>
    `;
    return;
  }

  container.innerHTML = vehicles
    .map(
      (v, index) => `
        <div class="risky-vehicle-item" style="border-left-color: ${v.grade.color}; cursor: pointer;" 
             onclick="showVehicleAlarms('${v.vehicle_name}', 1)">
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

// Tambahkan fungsi ini di akhir file
async function showVehicleAlarms(vehicleName, hours) {
  try {
    const response = await fetch(`/api/alarms/by-vehicle/${encodeURIComponent(vehicleName)}?hours=${hours}&limit=20`);
    const data = await response.json();
    displayAlarmModal(data);
  } catch (err) {
    console.error("Error loading vehicle alarms:", err);
    alert("Failed to load alarms");
  }
}

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

function getFileIcon(fileType) {
  // 1 = image, 2 = video, 3 = audio, others = file
  const icons = {
    1: "fa-image",
    2: "fa-video",
    3: "fa-file-audio",
  };
  return icons[fileType] || "fa-file";
}

function formatFileSize(bytes) {
  if (!bytes) return "Unknown";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

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
                      <i class="fas fa-paperclip"></i> ${alarm.files.length} file(s) available
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

function renderFilesList(files) {
  const images = files.filter((f) => f.file_type === 1);
  const videos = files.filter((f) => f.file_type === 2);
  const others = files.filter((f) => f.file_type !== 1 && f.file_type !== 2);

  // Base URL untuk file dari TGTrack
  const getFileUrl = (relativePath) => {
    if (relativePath.startsWith("http")) return relativePath;
    return `https://ds.tgtrack.com${relativePath.startsWith("/") ? "" : "/"}${relativePath}`;
  };

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
              <div class="image-thumb" onclick="viewFile('${fileUrl}', 1)">
                <img src="${fileUrl}" alt="Image ${idx + 1}" loading="lazy" 
                     onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect fill=%22%23ddd%22 width=%22100%22 height=%22100%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22%3ENo Image%3C/text%3E%3C/svg%3E'">
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

  // Video files
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
                <button class="btn-view" onclick="viewFile('${fileUrl}', 2)" title="Play">
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

  // Other files
  if (others.length > 0) {
    html += `
      <div class="file-section">
        <div class="file-section-title"><i class="fas fa-file"></i> Other Files (${others.length})</div>
        ${others
          .map((file, idx) => {
            const fileUrl = getFileUrl(file.relative_path);
            return `
            <div class="file-item">
              <div class="file-info">
                <i class="fas ${getFileIcon(file.file_type)}"></i>
                <span class="file-name">${file.file_name || `File ${idx + 1}`}</span>
                <span class="file-size">(${formatFileSize(file.file_size)})</span>
              </div>
              <div class="file-actions">
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


function viewFile(filePath, fileType) {
  if (fileType === 1) {
    // Image viewer with navigation
    const imageModal = `
      <div class="file-viewer-modal" onclick="if(event.target.className === 'file-viewer-modal') this.remove()">
        <div class="file-viewer-content">
          <span class="close-viewer" onclick="this.parentElement.parentElement.remove()">&times;</span>
          <img src="${filePath}" style="max-width: 90vw; max-height: 90vh; border-radius: 8px;">
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
  } else if (fileType === 2) {
    // Video viewer
    const videoModal = `
      <div class="file-viewer-modal" onclick="if(event.target.className === 'file-viewer-modal') this.remove()">
        <div class="file-viewer-content">
          <span class="close-viewer" onclick="this.parentElement.parentElement.remove()">&times;</span>
          <video controls autoplay style="max-width: 90vw; max-height: 90vh; border-radius: 8px;">
            <source src="${filePath}" type="video/mp4">
            Your browser does not support the video tag.
          </video>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML("beforeend", videoModal);
  }
}


function closeAlarmModal() {
  const modal = document.getElementById("alarm-modal");
  if (modal) modal.remove();
}

function initMap() {
  const defaultCenter = { lat: -6.2088, lng: 106.8456 };

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

  loadFleetData();

  // Auto refresh every 10 seconds
  setInterval(loadFleetData, 10000);
}

async function loadFleetData() {
  try {
    const response = await fetch("/api/coordinates/latest");
    const data = await response.json();

    updateMap(data);
    updateTable(data);
  } catch (err) {
    console.error("Error loading fleet data:", err);
  }
}

function updateMap(vehicles) {
  const bounds = new google.maps.LatLngBounds();

  vehicles.forEach((vehicle) => {
    const position = { lat: vehicle.lat, lng: vehicle.lng };
    const status = getVehicleStatus(vehicle);

    if (markers[vehicle.imei]) {
      markers[vehicle.imei].setPosition(position);
      markers[vehicle.imei].setIcon(getMarkerIcon(status, vehicle.speed, vehicle.azimuth));
    } else {
      const marker = new google.maps.Marker({
        position: position,
        map: map,
        title: vehicle.vehicle_name,
        icon: getMarkerIcon(status, vehicle.speed, vehicle.azimuth),
      });

      const infoWindow = new google.maps.InfoWindow({
        content: getInfoWindowContent(vehicle),
      });

      marker.addListener("click", () => {
        closeAllInfoWindows();
        infoWindow.open(map, marker);
        highlightVehicleRow(vehicle.imei);
      });

      markers[vehicle.imei] = marker;
      infoWindows[vehicle.imei] = infoWindow;
    }

    infoWindows[vehicle.imei].setContent(getInfoWindowContent(vehicle));
    bounds.extend(position);
  });

  if (vehicles.length > 0) {
    map.fitBounds(bounds);
  }
}

function getVehicleStatus(vehicle) {
  if (vehicle.speed > 5) return "moving";
  if (vehicle.speed > 0) return "idle";
  return "stopped";
}

function getMarkerIcon(status, speed, azimuth) {
  const colors = {
    moving: "#22c55e",
    stopped: "#ef4444",
    idle: "#f59e0b",
  };

  return {
    path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
    scale: 5,
    fillColor: colors[status],
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 2,
    rotation: azimuth || 0,
  };
}

function getInfoWindowContent(vehicle) {
  const status = getVehicleStatus(vehicle);
  const lastUpdate = new Date(vehicle.event_time).toLocaleString("id-ID");

  return `
        <div style="padding: 10px; min-width: 250px;">
            <h3 style="margin: 0 0 10px 0; color: #003d5c;">${vehicle.vehicle_name}</h3>
            <div style="font-size: 13px; line-height: 1.8;">
                <div><strong>Status:</strong> <span style="color: ${getStatusColor(
                  status
                )}; font-weight: 600;">${status.toUpperCase()}</span></div>
                <div><strong>Speed:</strong> ${vehicle.speed} km/h</div>
                <div><strong>Mileage:</strong> ${vehicle.mileage.toFixed(1)} km</div>
                <div><strong>Satellites:</strong> ${vehicle.additional?.satellites || 0}</div>
                <div><strong>Last Update:</strong> ${lastUpdate}</div>
            </div>
            <div style="margin-top: 10px;">
                <a href="https://www.google.com/maps?q=${vehicle.lat},${
    vehicle.lng
  }" target="_blank" style="color: #0066a1; text-decoration: none;">
                    <i class="fas fa-external-link-alt"></i> Open in Google Maps
                </a>
            </div>
        </div>
    `;
}

function getStatusColor(status) {
  const colors = {
    moving: "#22c55e",
    stopped: "#ef4444",
    idle: "#f59e0b",
  };
  return colors[status] || "#666";
}

function updateTable(vehicles) {
  const tbody = document.getElementById("fleetTableBody");

  if (vehicles.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="9" style="text-align: center; padding: 40px;">No vehicle data available</td></tr>';
    return;
  }

  tbody.innerHTML = vehicles
    .map((vehicle) => {
      const status = getVehicleStatus(vehicle);
      const lastUpdate = new Date(vehicle.event_time);
      const timeDiff = Math.floor((Date.now() - lastUpdate.getTime()) / 1000);
      const timeAgo = formatTimeAgo(timeDiff);
      const heading = getCompassDirection(vehicle.azimuth);

      return `
            <tr class="vehicle-row" data-imei="${vehicle.imei}" onclick="selectVehicle('${vehicle.imei}')">
                <td>
                    <strong>${vehicle.vehicle_name}</strong><br>
                    <small style="color: #666;">${vehicle.imei}</small>
                </td>
                <td>
                    <span class="status-badge status-${status}">${status}</span>
                </td>
                <td>
                    <span class="speed-indicator">${vehicle.speed}</span>
                </td>
                <td>
                    ${heading} (${vehicle.azimuth}°)
                </td>
                <td>
                    ${vehicle.mileage.toFixed(1)}
                </td>
                <td>
                    <a href="https://www.google.com/maps?q=${vehicle.lat},${
        vehicle.lng
      }" target="_blank" class="location-link">
                        ${vehicle.lat.toFixed(6)}, ${vehicle.lng.toFixed(6)}
                    </a>
                </td>
                <td>
                    <i class="fas fa-satellite"></i> ${vehicle.additional?.satellites || 0} sats<br>
                    <small style="color: #666;">Signal: ${vehicle.additional?.gsm_signal || 0}</small>
                </td>
                <td>
                    <span class="last-update">${timeAgo}</span><br>
                    <small style="color: #666;">${lastUpdate.toLocaleTimeString("id-ID")}</small>
                </td>
                <td>
                    <button class="btn-icon" onclick="event.stopPropagation(); viewHistory('${
                      vehicle.imei
                    }')" title="View History">
                        <i class="fas fa-history"></i>
                    </button>
                </td>
            </tr>
        `;
    })
    .join("");
}

function selectVehicle(imei) {
  document.querySelectorAll(".vehicle-row").forEach((row) => {
    row.classList.remove("selected");
  });

  const row = document.querySelector(`[data-imei="${imei}"]`);
  if (row) {
    row.classList.add("selected");
  }

  if (markers[imei]) {
    map.setCenter(markers[imei].getPosition());
    map.setZoom(15);

    closeAllInfoWindows();
    infoWindows[imei].open(map, markers[imei]);
  }

  selectedVehicle = imei;
}

function highlightVehicleRow(imei) {
  document.querySelectorAll(".vehicle-row").forEach((row) => {
    row.classList.remove("selected");
  });

  const row = document.querySelector(`[data-imei="${imei}"]`);
  if (row) {
    row.classList.add("selected");
    row.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function closeAllInfoWindows() {
  Object.values(infoWindows).forEach((iw) => iw.close());
}

function getCompassDirection(azimuth) {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(azimuth / 45) % 8;
  return directions[index];
}

function formatTimeAgo(seconds) {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function refreshData() {
  loadFleetData();
  loadSafetyScores();
}

function viewHistory(imei) {
  window.location.href = `/history/${imei}`;
}

function exportToExcel() {
  window.open(`/api/fleet/export?format=excel`, "_blank");
}
