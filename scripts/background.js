// =============================================================================
// Service Worker - Gestiona eventos en segundo plano
// =============================================================================

// Constantes de configuración
const CONFIG = {
  STATS_KEY: 'adblock_stats',
  ENABLED_KEY: 'adblock_enabled',
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

  if (data[CONFIG.DYNAMIC_RULES_KEY] === undefined) {
    initialData[CONFIG.DYNAMIC_RULES_KEY] = INITIAL_DYNAMIC_RULES;
  }

  if (Object.keys(initialData).length > 0) {
    await chrome.storage.local.set(initialData);
  }

  console.log('✅ Bloqueador inicializado correctamente');
});

// Escuchar coincidencias de reglas DNR para contar bloqueos
chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
  // Solo contar si la extensión está habilitada
  const data = await chrome.storage.local.get(CONFIG.ENABLED_KEY);
  if (data[CONFIG.ENABLED_KEY] === false) return;

  // Incrementar estadísticas para bloqueos DNR
  await handleAdBlocked({
    type: 'dnr-blocked',
    url: info.request.url,
    tabId: info.request.tabId,
    timestamp: Date.now()
  });

  console.log('🚫 DNR bloqueado:', info.request.url);
});

/**
 * Escuchar mensajes desde content scripts
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'adBlocked') {
    const details = request.details || {};
    details.tabId = sender.tab ? sender.tab.id : 'unknown';
    handleAdBlocked(details);
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
  } else if (request.action === 'deepClean') {
    performDeepClean().then(result => sendResponse(result));
    return true;
  }
});

/**
 * Realiza una limpieza profunda de cookies de rastreo y almacenamiento
 */
async function performDeepClean() {
  console.log('🧹 Iniciando limpieza profunda...');
  
  try {
    // 1. Limpiar cookies de dominios publicitarios conocidos
    const adDomains = [
      'googleads.g.doubleclick.net',
      'googleadservices.com',
      'googlesyndication.com',
      'doubleclick.net',
      'adservice.google.com'
    ];

    let cookiesRemoved = 0;
    for (const domain of adDomains) {
      try {
        const cookies = await chrome.cookies.getAll({ domain });
        for (const cookie of cookies) {
          try {
            // Construir URL válida para la cookie - eliminar puntos iniciales del dominio
            let cleanDomain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
            const protocol = cookie.secure ? 'https:' : 'http:';
            const url = `${protocol}//${cleanDomain}${cookie.path}`;
            await chrome.cookies.remove({ name: cookie.name, url });
            cookiesRemoved++;
          } catch (cookieError) {
            console.warn(`⚠️ No se pudo eliminar cookie ${cookie.name} en ${cookie.domain}:`, cookieError.message);
          }
        }
      } catch (domainError) {
        console.warn(`⚠️ No se pudieron obtener cookies para ${domain}:`, domainError.message);
      }
    }

    console.log(`✅ Se eliminaron ${cookiesRemoved} cookies de rastreo`);

    // 2. Notificar a las pestañas de YouTube para limpiar almacenamiento local
    const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { action: 'clearStorage' }).catch(() => {});
    }

    return { success: true, cookiesRemoved };
  } catch (error) {
    console.error('❌ Error en limpieza profunda:', error);
    return { success: false, error: error.message };
  }
}

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

// Mapa para rastrear el último bloqueo por pestaña y evitar duplicados rápidos
const lastBlockedTimeByTab = new Map();
const THROTTLE_MS = 2000; // 2 segundos de ventana para agrupar bloqueos similares

/**
 * Maneja el evento de anuncio bloqueado
 */
async function handleAdBlocked(details) {
  const tabId = details.tabId || 'unknown';
  const now = Date.now();
  const lastTime = lastBlockedTimeByTab.get(tabId) || 0;

  // Si el último bloqueo en esta pestaña fue hace menos de THROTTLE_MS, 
  // no incrementamos el contador global, pero podemos loguearlo
  if (now - lastTime < THROTTLE_MS) {
    console.log('⏳ Bloqueo ignorado por el contador (Throttled):', details.type);
    return;
  }

  lastBlockedTimeByTab.set(tabId, now);
  console.log('📊 Anuncio bloqueado:', details.type, 'URL:', details.url);

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

  console.log('📈 Stats actualizadas - Hoy:', stats.todayBlocked, 'Total:', stats.totalBlocked);
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
