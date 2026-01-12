// =============================================================================
// Service Worker - Gestiona eventos en segundo plano
// =============================================================================

// Constantes de configuración
const CONFIG = {
  STATS_KEY: 'adblock_stats',
  ENABLED_KEY: 'adblock_enabled',
  WHITELIST_KEY: 'channel_whitelist',
  DYNAMIC_RULES_KEY: 'dynamic_ad_rules'
};

// Estructura inicial de reglas dinámicas
const INITIAL_DYNAMIC_RULES = {
  domains: [],
  patterns: [],
  selectors: []
};

// Inicializar al instalar la extensión
chrome.runtime.onInstalled.addListener(async () => {
  console.log('🚫 Bloqueador de YouTube instalado o actualizado');
  
  // Asegurarse de que navigationPreload esté desactivado si no se usa
  try {
    if (self.registration && self.registration.navigationPreload) {
      await self.registration.navigationPreload.disable();
    }
  } catch (e) {}

  const data = await chrome.storage.local.get([
    CONFIG.ENABLED_KEY,
    CONFIG.STATS_KEY,
    CONFIG.WHITELIST_KEY,
    CONFIG.DYNAMIC_RULES_KEY
  ]);
  
  const initialData = {};
  
  // Solo inicializar si no existen para no borrar datos previos en actualizaciones
  if (data[CONFIG.ENABLED_KEY] === undefined) {
    initialData[CONFIG.ENABLED_KEY] = true;
  }
  
  if (data[CONFIG.STATS_KEY] === undefined) {
    initialData[CONFIG.STATS_KEY] = {
      totalBlocked: 0,
      todayBlocked: 0,
      lastReset: new Date().toDateString()
    };
  }
  
  if (data[CONFIG.WHITELIST_KEY] === undefined) {
    initialData[CONFIG.WHITELIST_KEY] = [];
  }

  if (data[CONFIG.DYNAMIC_RULES_KEY] === undefined) {
    initialData[CONFIG.DYNAMIC_RULES_KEY] = INITIAL_DYNAMIC_RULES;
  }
  
  if (Object.keys(initialData).length > 0) {
    await chrome.storage.local.set(initialData);
  }
  
  console.log('✅ Bloqueador inicializado correctamente');
});

/**
 * Escuchar mensajes desde content scripts
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'adBlocked') {
    handleAdBlocked(request.details);
    sendResponse({ success: true });
  } else if (request.action === 'getStats') {
    getStats().then(stats => sendResponse(stats));
    return true; // Indica respuesta asíncrona
  } else if (request.action === 'toggleEnabled') {
    toggleEnabled().then(enabled => sendResponse({ enabled }));
    return true;
  } else if (request.action === 'resetStats') {
    resetStats().then(() => sendResponse({ success: true }));
    return true;
  } else if (request.action === 'addDynamicRule') {
    addDynamicRule(request.ruleType, request.rule).then(() => sendResponse({ success: true }));
    return true;
  } else if (request.action === 'getDynamicRules') {
    getDynamicRules().then(rules => sendResponse(rules));
    return true;
  }
});

/**
 * Añade una regla dinámica a la lista
 */
async function addDynamicRule(ruleType, rule) {
  const data = await chrome.storage.local.get(CONFIG.DYNAMIC_RULES_KEY);
  const rules = data[CONFIG.DYNAMIC_RULES_KEY] || { ...INITIAL_DYNAMIC_RULES };
  
  if (!rules[ruleType]) return;
  
  // Evitar duplicados
  if (!rules[ruleType].includes(rule)) {
    rules[ruleType].push(rule);
    await chrome.storage.local.set({ [CONFIG.DYNAMIC_RULES_KEY]: rules });
    console.log(`🆕 Nueva regla dinámica añadida (${ruleType}):`, rule);
  }
}

/**
 * Obtiene todas las reglas dinámicas
 */
async function getDynamicRules() {
  const data = await chrome.storage.local.get(CONFIG.DYNAMIC_RULES_KEY);
  return data[CONFIG.DYNAMIC_RULES_KEY] || INITIAL_DYNAMIC_RULES;
}

/**
 * Maneja el evento de anuncio bloqueado
 */
async function handleAdBlocked(details) {
  const data = await chrome.storage.local.get(CONFIG.STATS_KEY);
  const stats = data[CONFIG.STATS_KEY] || {
    totalBlocked: 0,
    todayBlocked: 0,
    lastReset: new Date().toDateString()
  };
  
  // Resetear contador diario si es un nuevo día
  const today = new Date().toDateString();
  if (stats.lastReset !== today) {
    stats.todayBlocked = 0;
    stats.lastReset = today;
  }
  
  stats.totalBlocked++;
  stats.todayBlocked++;
  
  await chrome.storage.local.set({ [CONFIG.STATS_KEY]: stats });
  
  // Actualizar badge con el contador
  chrome.action.setBadgeText({ 
    text: stats.todayBlocked.toString() 
  });
  chrome.action.setBadgeBackgroundColor({ 
    color: '#FF0000' 
  });
}

/**
 * Obtiene las estadísticas actuales
 */
async function getStats() {
  const data = await chrome.storage.local.get([
    CONFIG.STATS_KEY,
    CONFIG.ENABLED_KEY
  ]);
  
  return {
    stats: data[CONFIG.STATS_KEY] || { 
      totalBlocked: 0, 
      todayBlocked: 0 
    },
    enabled: data[CONFIG.ENABLED_KEY] !== false
  };
}

/**
 * Activa/desactiva el bloqueador
 */
async function toggleEnabled() {
  const data = await chrome.storage.local.get(CONFIG.ENABLED_KEY);
  const newState = !data[CONFIG.ENABLED_KEY];
  
  await chrome.storage.local.set({ [CONFIG.ENABLED_KEY]: newState });
  
  // Actualizar ícono según el estado (sin icono disabled)
  const iconPath = 'icons/icon48.png';
  chrome.action.setIcon({ path: iconPath });
  
  return newState;
}

/**
 * Resetea las estadísticas
 */
async function resetStats() {
  await chrome.storage.local.set({
    [CONFIG.STATS_KEY]: {
      totalBlocked: 0,
      todayBlocked: 0,
      lastReset: new Date().toDateString()
    }
  });
  
  chrome.action.setBadgeText({ text: '0' });
}
