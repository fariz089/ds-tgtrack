// DataTable Helper Functions

// Format file size
function formatFileSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

// Check if file is image
function isImageFile(file) {
  if (file.file_type === 1) return true;
  const ext = (file.file_name || file.relative_path || "").toLowerCase();
  return (
    ext.endsWith(".jpg") ||
    ext.endsWith(".jpeg") ||
    ext.endsWith(".png") ||
    ext.endsWith(".gif") ||
    ext.endsWith(".bmp") ||
    ext.endsWith(".webp")
  );
}

// Check if file is video
function isVideoFile(file) {
  if (file.file_type === 2) return true;
  const ext = (file.file_name || file.relative_path || "").toLowerCase();
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

// Show file preview modal
function showFilePreview(alarmData) {
  const modal = document.getElementById("filePreviewModal");
  if (!modal) return;

  // Filter files (no .bin files)
  const files = (alarmData.files || []).filter((file) => {
    const fileName = (file.file_name || "").toLowerCase();
    return !fileName.endsWith(".bin") && !fileName.endsWith(".dat");
  });

  const images = files.filter((f) => isImageFile(f));
  const videos = files.filter((f) => isVideoFile(f));

  // Update modal content
  document.getElementById("previewVehicleName").textContent = alarmData.vehicle_name;
  document.getElementById("previewAlarmType").textContent = alarmData.alarm_type;
  document.getElementById("previewEventTime").textContent = new Date(alarmData.event_time).toLocaleString("id-ID");
  document.getElementById("previewSpeed").textContent = `${alarmData.speed} km/h`;
  document.getElementById("previewLocation").textContent = `${alarmData.lat.toFixed(6)}, ${alarmData.lng.toFixed(6)}`;

  // Render files grid
  const filesGrid = document.getElementById("filesGrid");

  if (images.length === 0 && videos.length === 0) {
    filesGrid.innerHTML = `
      <div class="no-files-message">
        <i class="fas fa-folder-open"></i>
        <div>No media files available</div>
      </div>
    `;
  } else {
    let html = "";

    // Render images
    images.forEach((file) => {
      const fileUrl = getFileUrl(file.relative_path);
      html += `
        <div class="file-thumb" onclick="viewFileFullscreen('${fileUrl}', 'image')">
          <div class="file-thumb-image">
            <img src="${fileUrl}" alt="${file.file_name}" loading="lazy" 
                 onerror="this.parentElement.innerHTML='<div style=padding:20px;text-align:center;color:#999>❌</div>'">
          </div>
          <div class="file-thumb-info">
            <div class="file-thumb-name" title="${file.file_name}">${file.file_name}</div>
            <div class="file-thumb-size">${formatFileSize(file.file_size)}</div>
          </div>
        </div>
      `;
    });

    // Render videos WITH thumbnail
    videos.forEach((file) => {
      const fileUrl = getFileUrl(file.relative_path);
      html += `
        <div class="file-thumb" onclick="viewFileFullscreen('${fileUrl}', 'video')">
          <div class="file-thumb-video">
            <video preload="metadata">
              <source src="${fileUrl}#t=0.5" type="video/mp4">
            </video>
          </div>
          <div class="file-thumb-info">
            <div class="file-thumb-name" title="${file.file_name}">${file.file_name}</div>
            <div class="file-thumb-size">${formatFileSize(file.file_size)}</div>
          </div>
        </div>
      `;
    });

    filesGrid.innerHTML = html;
  }

  // Show modal
  modal.classList.add("active");
}

// Close file preview modal
function closeFilePreview() {
  const modal = document.getElementById("filePreviewModal");
  if (modal) {
    modal.classList.remove("active");
  }
}

// View file fullscreen
function viewFileFullscreen(filePath, fileType) {
  const viewer = document.getElementById("fileViewerFullscreen");
  const content = document.getElementById("fileViewerContent");

  if (fileType === "image") {
    content.innerHTML = `
      <img src="${filePath}" alt="Image">
      <div class="file-actions">
        <a href="${filePath}" download class="btn-file-action">
          <i class="fas fa-download"></i> Download
        </a>
        <a href="${filePath}" target="_blank" class="btn-file-action">
          <i class="fas fa-external-link-alt"></i> Open in New Tab
        </a>
      </div>
    `;
  } else if (fileType === "video") {
    content.innerHTML = `
      <video controls autoplay>
        <source src="${filePath}" type="video/mp4">
        <source src="${filePath}" type="video/webm">
        Your browser does not support video playback.
      </video>
      <div class="file-actions">
        <a href="${filePath}" download class="btn-file-action">
          <i class="fas fa-download"></i> Download
        </a>
        <a href="${filePath}" target="_blank" class="btn-file-action">
          <i class="fas fa-external-link-alt"></i> Open in New Tab
        </a>
      </div>
    `;
  }

  viewer.classList.add("active");
}

// Close fullscreen viewer
function closeFileViewer() {
  const viewer = document.getElementById("fileViewerFullscreen");
  if (viewer) {
    viewer.classList.remove("active");
    // Stop video if playing
    const video = viewer.querySelector("video");
    if (video) video.pause();
  }
}

// Close modal on background click
document.addEventListener("click", function (e) {
  if (e.target.classList.contains("file-preview-modal")) {
    closeFilePreview();
  }
  if (e.target.classList.contains("file-viewer-fullscreen")) {
    closeFileViewer();
  }
});

// Close on Escape key
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    closeFilePreview();
    closeFileViewer();
  }
});
