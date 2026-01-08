// =============================================================================
// Script inyectado en páginas de YouTube
// =============================================================================

/**
 * Log personalizado para depuración (usa el de blocker.js si está disponible)
 */
function contentLog(...args) {
  if (typeof debugLog === 'function') {
    debugLog(...args);
  }
}

console.log('🎯 Content script de bloqueador de anuncios cargado');

// Variables globales
let isEnabled = true;
let observer = null;
let checkInterval = null;
let debouncedCheck = null;

/**
 * Espera a que document.body esté disponible
 */
function waitForBody(timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function tick() {
      if (document.body && document.body.nodeType === 1) return resolve(document.body);
      if (Date.now() - start > timeout) return reject(new Error('document.body no disponible'));
      setTimeout(tick, 25);
    })();
  });
}

/**
 * Inicializa el content script
 */
async function initialize() {
  try {
    // Verificar si el bloqueador está habilitado
    const data = await chrome.storage.local.get('adblock_enabled');
    isEnabled = data.adblock_enabled !== false;

    if (!isEnabled) {
      console.log('⏸️ Bloqueador deshabilitado');
      return;
    }

    // Asegurar body
    await waitForBody().catch(() => {});

    // Iniciar observador de DOM
    startDOMObserver();

    // Iniciar verificación periódica
    startPeriodicCheck();

    // Escuchar cambios en la navegación SPA de YouTube
    listenToNavigation();
  } catch (e) {
    console.error('Error al inicializar content script:', e);
  }
}

/**
 * Inicia el observador de mutaciones del DOM
 */
function startDOMObserver() {
  if (observer) {
    try { observer.disconnect(); } catch (_) {}
  }

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes && mutation.addedNodes.length) {
        scheduleCheck();
        break;
      }
    }
  });

  const target = document.body;
  if (target && typeof target.nodeType === 'number') {
    observer.observe(target, {
      childList: true,
      subtree: true
    });
    contentLog('👁️ Observador de DOM iniciado');
  } else {
    // Reintentar pronto si aún no hay body
    setTimeout(startDOMObserver, 100);
  }
}

/**
 * Programa una verificación de anuncios de forma amortiguada (Debounce)
 */
function scheduleCheck(delay = 100) {
  if (debouncedCheck) {
    clearTimeout(debouncedCheck);
  }
  debouncedCheck = setTimeout(() => {
    debouncedCheck = null;
    if (isEnabled) checkForAds();
  }, delay);
}

/**
 * Inicia verificación periódica de anuncios
 */
function startPeriodicCheck() {
  let baseDelay = 700;
  let timerId = null;

  function loop() {
    if (!isEnabled) return;

    // Ajustar frecuencia según el contexto
    let delay = baseDelay;
    if (document.visibilityState === 'hidden') {
      delay = Math.max(baseDelay * 3, 1500);
    } else if (location.pathname === '/watch') {
      delay = 300; // Frecuencia aumentada en reproducción para saltar anuncios rápido
    }

    // Usar requestIdleCallback si existe para reducir jank
    const schedule = window.requestIdleCallback || function(cb){ return setTimeout(() => cb({ didTimeout:false, timeRemaining: () => 0 }), 0); };
    const cancel = window.cancelIdleCallback || clearTimeout;

    const idleId = schedule(() => {
      try { checkForAds(); } catch (e) { /* noop */ }
      timerId = setTimeout(loop, delay);
    }, { timeout: delay });

    // Guardar referencia para poder limpiar
    checkInterval = { idleId, timerId, cancel, clear: clearTimeout };
  }

  loop();
}

/**
 * Limpia observadores y timers
 */
function cleanupObservers() {
  try { observer?.disconnect(); } catch (_) {}
  observer = null;
  if (checkInterval) {
    try { checkInterval.cancel?.(checkInterval.idleId); } catch (_) {}
    try { checkInterval.clear?.(checkInterval.timerId); } catch (_) {}
  }
  checkInterval = null;
  if (debouncedCheck) { clearTimeout(debouncedCheck); debouncedCheck = null; }
}

/**
 * Escucha cambios de navegación en YouTube (SPA)
 */
function listenToNavigation() {
  // YouTube es una SPA, usamos sus eventos personalizados para mayor eficiencia
  const handleNav = () => {
    const url = location.href;
    contentLog('📍 Navegación detectada:', url);

    // Reiniciar observadores y chequeos para la nueva vista
    cleanupObservers();
    startDOMObserver();
    startPeriodicCheck();
    // Hacer un chequeo inicial tras un breve retraso
    setTimeout(() => { scheduleCheck(150); }, 500);
  };

  window.addEventListener('yt-navigate-finish', handleNav);
  window.addEventListener('sp-navigate-finish', handleNav); // Variante para algunos contextos
  
  // Como fallback para casos raros o navegación de historial estándar
  window.addEventListener('popstate', () => {
    setTimeout(() => { scheduleCheck(200); }, 500);
  });
}

/**
 * Verifica y bloquea anuncios en la página
 */
function checkForAds() {
  const now = Date.now();
  
  // 1. Saltar anuncios de video (Prioridad ALTA)
  if (typeof skipVideoAd === 'function') skipVideoAd();
  
    // 2. Otras tareas de limpieza (Prioridad MEDIA - cada 1s aprox)
    if (!window._lastDeepClean || (now - window._lastDeepClean > 1000)) {
        window._lastDeepClean = now;
        if (typeof hideAdElements === 'function') hideAdElements();
        if (typeof removeAdOverlays === 'function') removeAdOverlays();
        if (typeof cleanupEmptySpaces === 'function') cleanupEmptySpaces();
        injectBypassButton();
    }
}

/**
 * Inyecta un botón para ver el video en la versión sin anuncios (yout-ube.com)
 */
function injectBypassButton() {
    if (location.pathname !== '/watch') return;
    if (document.getElementById('yt-adblock-bypass-button')) return;

    // Buscar el contenedor donde insertar el botón (debajo del video o cerca del botón de suscripción)
    const target = document.querySelector('#owner, #top-row #actions, #subscribe-button');
    if (!target) return;

    const bypassBtn = document.createElement('a');
    bypassBtn.id = 'yt-adblock-bypass-button';
    bypassBtn.className = 'yt-adblock-bypass-btn';
    bypassBtn.href = window.getHyphenatedUrl?.(location.href) || location.href.replace('youtube.com', 'yout-ube.com');
    bypassBtn.target = '_blank';
    bypassBtn.innerHTML = '<span>🛡️</span> Ver sin anuncios (yout-ube)';
    
    // Insertar el botón
    target.parentElement.insertBefore(bypassBtn, target.nextSibling);
    contentLog('🚀 Botón de Bypass Alternativo inyectado');
}

/**
 * Notifica al background script sobre un anuncio bloqueado
 */
function notifyAdBlocked(type) {
  chrome.runtime.sendMessage({
    action: 'adBlocked',
    details: {
      type: type,
      url: window.location.href,
      timestamp: Date.now()
    }
  }).catch(err => console.error('Error enviando mensaje:', err));
}

// Exportar funciones para que blocker.js las use
window.notifyAdBlocked = notifyAdBlocked;

// Escuchar mensajes desde el MAIN world (interceptor.js)
window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  
  // Notificación de anuncio bloqueado
  if (event.data && event.data.type === 'YT_ADBLOCK_EVENT') {
    contentLog('📩 Mensaje recibido del interceptor:', event.data.detail);
    notifyAdBlocked(event.data.detail);
  }

  // Detección de nuevo anuncio (dinámico)
  if (event.data && event.data.type === 'YT_AD_DETECTED') {
    const { ruleType, rule } = event.data;
    contentLog(`🆕 Nuevo anuncio detectado (${ruleType}):`, rule);
    chrome.runtime.sendMessage({
      action: 'addDynamicRule',
      ruleType: ruleType,
      rule: rule
    });
  }

  // Petición de reglas dinámicas desde el Main World
  if (event.data && event.data.type === 'GET_DYNAMIC_RULES') {
    try {
      const rules = await chrome.runtime.sendMessage({ action: 'getDynamicRules' });
      window.postMessage({ type: 'DYNAMIC_RULES_DATA', rules: rules }, '*');
    } catch (e) {
      console.error('Error al obtener reglas dinámicas:', e);
    }
  }
});

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}