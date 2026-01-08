// Referencias a elementos del DOM
const elements = {
  toggleEnabled: document.getElementById("toggleEnabled"),
  statusBadge: document.getElementById("statusBadge"),
  statusText: document.getElementById("statusText"),
  todayCount: document.getElementById("todayCount"),
  totalCount: document.getElementById("totalCount"),
  refreshBtn: document.getElementById("refreshBtn"),
  bypassBtn: document.getElementById("bypassBtn"),
  whitelistBtn: document.getElementById("whitelistBtn"),
  resetBtn: document.getElementById("resetBtn"),
};

/**
 * Inicializa el popup cargando datos
 */
async function initialize() {
  try {
    await loadStats();
    setupEventListeners();
    console.log("✅ Popup inicializado correctamente");
  } catch (error) {
    console.error("❌ Error inicializando popup:", error);
  }
}

/**
 * Carga las estadísticas desde el background script
 */
async function loadStats() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: "getStats",
    });

    if (response) {
      updateUI(response);
    }
  } catch (error) {
    console.error("Error cargando estadísticas:", error);
  }
}

// Variables de estado local para evitar animaciones innecesarias
let currentStats = {
  today: -1,
  total: -1
};

/**
 * Actualiza la interfaz con los datos recibidos
 */
function updateUI(data) {
  const { stats, enabled } = data;
  
  const today = stats.todayBlocked || 0;
  const total = stats.totalBlocked || 0;

  // Solo animar si los valores han cambiado
  if (today !== currentStats.today) {
    animateValue(elements.todayCount, currentStats.today === -1 ? 0 : currentStats.today, today, 500);
    currentStats.today = today;
  } else {
    elements.todayCount.textContent = today;
  }

  if (total !== currentStats.total) {
    animateValue(elements.totalCount, currentStats.total === -1 ? 0 : currentStats.total, total, 500);
    currentStats.total = total;
  } else {
    elements.totalCount.textContent = total;
  }

  // Actualizar estado del toggle
  elements.toggleEnabled.checked = enabled;

  // Actualizar badge de estado
  if (enabled) {
    elements.statusBadge.className = "status-badge active";
    elements.statusText.textContent = "Protección Activa";
  } else {
    elements.statusBadge.className = "status-badge inactive";
    elements.statusText.textContent = "Protección Desactivada";
  }
}

/**
 * Anima el cambio de un valor numérico
 */
function animateValue(element, start, end, duration) {
  const range = end - start;
  const increment = range / (duration / 16);
  let current = start;

  const timer = setInterval(() => {
    current += increment;
    if (
      (increment > 0 && current >= end) ||
      (increment < 0 && current <= end)
    ) {
      element.textContent = end;
      clearInterval(timer);
    } else {
      element.textContent = Math.floor(current);
    }
  }, 16);
}

/**
 * Configura los event listeners de los botones
 */
function setupEventListeners() {
  // Toggle de activación/desactivación
  elements.toggleEnabled.addEventListener("change", async (e) => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "toggleEnabled",
      });

      if (response) {
        showNotification(
          response.enabled ? "Bloqueador activado" : "Bloqueador desactivado",
          response.enabled ? "success" : "info"
        );
        await loadStats();
      }
    } catch (error) {
      console.error("Error al cambiar estado:", error);
    }
  });

  // Botón de actualizar
  elements.refreshBtn.addEventListener("click", async () => {
    elements.refreshBtn.disabled = true;
    elements.refreshBtn.innerHTML = "<span>⏳</span> Actualizando...";

    await loadStats();

    setTimeout(() => {
      elements.refreshBtn.disabled = false;
      elements.refreshBtn.innerHTML = "<span>🔄</span> Actualizar Estadísticas";
      showNotification("Estadísticas actualizadas", "success");
    }, 500);
  });

  // Botón de Bypass Alternativo
  elements.bypassBtn.addEventListener("click", async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.url.includes("youtube.com/watch")) {
        const newUrl = tab.url.replace("youtube.com", "yout-ube.com");
        chrome.tabs.create({ url: newUrl });
      } else {
        showNotification("Abre un video de YouTube primero", "info");
      }
    } catch (error) {
      console.error("Error al redirigir:", error);
    }
  });

  // Botón de lista blanca
  elements.whitelistBtn.addEventListener("click", () => {
    showNotification("Función de lista blanca próximamente", "info");
    // Aquí se puede implementar una nueva página de configuración
  });

  // Botón de resetear
  elements.resetBtn.addEventListener("click", async () => {
    const confirmed = confirm(
      "¿Estás seguro de que deseas resetear las estadísticas?"
    );

    if (confirmed) {
      try {
        await chrome.runtime.sendMessage({ action: "resetStats" });
        await loadStats();
        showNotification("Estadísticas reseteadas", "success");
      } catch (error) {
        console.error("Error reseteando estadísticas:", error);
      }
    }
  });
}

/**
 * Muestra una notificación temporal
 */
function showNotification(message, type = "info") {
  const notification = document.createElement("div");
  notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: ${
          type === "success"
            ? "#4CAF50"
            : type === "error"
            ? "#f44336"
            : "#2196F3"
        };
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 1000;
        font-size: 14px;
        animation: slideDown 0.3s ease;
      `;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = "slideUp 0.3s ease";
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

// Inicializar cuando el DOM esté listo
document.addEventListener("DOMContentLoaded", initialize);

// Actualizar stats cada 5 segundos si el popup está abierto
setInterval(loadStats, 5000);
