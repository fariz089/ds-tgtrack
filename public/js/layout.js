function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  sidebar.classList.toggle("collapsed");

  const isCollapsed = sidebar.classList.contains("collapsed");
  localStorage.setItem("sidebarCollapsed", isCollapsed);
}

document.addEventListener("DOMContentLoaded", function () {
  const isCollapsed = localStorage.getItem("sidebarCollapsed") === "true";
  if (isCollapsed) {
    document.getElementById("sidebar").classList.add("collapsed");
  }
});

function filterByVehicle() {
  const vehicle = document.getElementById("vehicleSelect").value;
  if (typeof loadData === "function") {
    loadData(vehicle);
  }
}
