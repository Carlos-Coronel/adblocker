// =============================================================================
// Lógica principal de detección y bloqueo de anuncios
// =============================================================================

const DEBUG_MODE = true;
const PERF_THRESHOLD = 15; // ms (un poco más alto para el DOM)

/**
 * Log personalizado para depuración
 */
function debugLog(level, ...args) {
  if (DEBUG_MODE) {
    const timestamp = new Date().toISOString().split('T')[1].split('Z')[0];
    const prefix = `[Blocker][${timestamp}][${level}]`;
    const logger = level === 'ERROR' ? console.error : (level === 'WARN' ? console.warn : (level === 'PERF' ? console.debug : console.log));
    logger(prefix, ...args);
  }
}
window.debugLog = debugLog; // Hacerlo disponible para content.js

/**
 * Función específica para logging de diagnóstico de carga
 */
function diagnosticLog(type, data) {
  if (DEBUG_MODE) {
    const timestamp = new Date().toISOString().split('T')[1].split('Z')[0];
    console.log(`[DIAGNOSTIC][${timestamp}][${type}]`, data);
  }
}
window.diagnosticLog = diagnosticLog; // Hacerlo disponible

/**
 * Monitor de rendimiento (Watchdog) para detectar bloqueos del hilo principal
 */
(function setupWatchdog() {
  if (!DEBUG_MODE) return;
  let lastTime = performance.now();
  let lastWarnTime = 0;
  function check() {
    const now = performance.now();
    const diff = now - lastTime;
    if (diff > 200 && (now - lastWarnTime > 1000)) { // Umbral de 200ms y throttle de 1s para logs
      debugLog('WARN', `⚠️ Posible bloqueo detectado: ${diff.toFixed(2)}ms sin responder`);
      lastWarnTime = now;
    }
    lastTime = now;
    requestAnimationFrame(check);
  }
  requestAnimationFrame(check);
})();

/**
 * Selectores CSS de elementos publicitarios en YouTube (CORREGIDOS)
 */
const AD_SELECTORS = [
  '.video-ads', '.ytp-ad-module', '.ytp-ad-overlay-container', '.ytp-ad-text-overlay', '.ytp-ad-player-overlay',
  'ytd-display-ad-renderer', 'ytd-promoted-sparkles-web-renderer', 'ytd-statement-banner-renderer', 'ytd-banner-promo-renderer',
  'ytd-action-companion-ad-renderer', 'ytd-video-masthead-ad-v3-renderer', 'ytd-companion-slot-renderer', 'ytd-in-feed-ad-layout-renderer',
  'ytd-player-legacy-desktop-watch-ads-renderer', '.ytd-search-pyv-renderer', 'ytd-ad-slot-renderer', 'yt-mealbar-promo-renderer',
  'yt-interaction-companion-ad-renderer', '.ytd-popup-container', '.ytd-promoted-video-renderer', '#player-ads',
  '.ytd-merch-shelf-renderer', 'ytd-ad-engagement-panel-renderer', 
  'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)', 'yt-playability-error-supported-renderers:has(ytd-enforcement-message-view-model)',
  '[class*="paid-content"]', '[class*="advertisement"]', '[aria-label*="Advertisement"]', '[aria-label*="Sponsorship"]',
  'ad-button-view-model', 'top-landscape-image-layout-view-model', '[class*="AdComponentHost"]', '.ytp-ad-survey-container',
  '.ytp-ad-action-interstitial', '[id^="ad-text:"]', '.ytp-ad-message-container'
];

let dynamicSelectors = [];

/**
 * Carga los selectores dinámicos desde el almacenamiento
 */
async function loadDynamicSelectors() {
  try {
    const data = await chrome.storage.local.get('dynamic_ad_rules');
    if (data.dynamic_ad_rules && data.dynamic_ad_rules.selectors) {
      dynamicSelectors = data.dynamic_ad_rules.selectors;
      debugLog('INFO', '📦 Selectores dinámicos cargados:', dynamicSelectors.length);
    }
  } catch (e) {
    // Silenciar errores en contextos restringidos
  }
}

// Intentar cargar al inicio
loadDynamicSelectors();

let userPreferences = {
  playbackRate: 1,
  muted: false
};
let wasAdActive = false;

/**
 * Intenta saltar un anuncio de video automáticamente (CORREGIDO)
 */
function skipVideoAd() {
  try {
    const video = document.querySelector('video.html5-main-video');
    const skipButton = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button');
    
    const adActive = isAdPlaying();
    
    // 1. Intentar hacer clic en el botón de saltar
    if (skipButton && skipButton.offsetParent !== null) {
      debugLog('INFO', '⏭️ Saltando anuncio de video (botón)');
      skipButton.click();
      window.notifyAdBlocked?.('video-ad-skipped');
      return true;
    }
    
    // 2. Si hay un anuncio activo, acelerarlo y adelantarlo
    if (video && adActive) {
      if (!wasAdActive) {
        // Guardar preferencias solo al inicio del anuncio
        // Si la velocidad ya es 16 (por un error previo), asumimos 1
        userPreferences.playbackRate = video.playbackRate >= 10 ? 1 : video.playbackRate;
        userPreferences.muted = video.muted;
        wasAdActive = true;
        debugLog('INFO', '🕒 Anuncio detectado, guardando preferencias:', userPreferences);
      }

      // Mute y aceleración (técnica muy efectiva y menos propensa a bloqueos)
      if (!video.muted) video.muted = true;
      if (video.playbackRate < 10) video.playbackRate = 16;
      
      if (typeof video.duration === 'number' && !isNaN(video.duration) && video.duration > 0 && video.duration !== Infinity) {
        // BUCLE FIX: Solo adelantamos si no estamos ya cerca del final
        if (video.currentTime < video.duration - 0.5) {
          video.currentTime = video.duration;
          debugLog('INFO', '⏩ Adelantando anuncio al final');
          window.notifyAdBlocked?.('video-ad-fast-forward');
          return true;
        }
      } else {
        // Si no tenemos duración, al menos pausamos si es necesario
        if (!video.paused) {
          video.pause();
          debugLog('INFO', '⏸️ Pausando anuncio de video (duración desconocida)');
          window.notifyAdBlocked?.('video-ad-paused');
          return true;
        }
      }
    } else if (video && wasAdActive && !adActive) {
      // Restaurar velocidad y mute si el anuncio terminó
      video.playbackRate = userPreferences.playbackRate;
      video.muted = userPreferences.muted;
      wasAdActive = false;
      debugLog('INFO', '▶️ Anuncio finalizado. Restaurando:', userPreferences);
    } else if (video && video.playbackRate === 16 && !adActive) {
      // Backup en caso de que wasAdActive fallara
      video.playbackRate = 1;
      video.muted = false;
      debugLog('INFO', '▶️ Restaurando velocidad normal (backup)');
    }
    
    return false;
  } catch (error) {
    console.error('Error en skipVideoAd:', error);
    return false;
  }
}

let lastIsAdPlayingResult = false;
let lastIsAdPlayingTime = 0;

/**
 * Verifica si hay un anuncio reproduciéndose (Con cache de 100ms)
 */
function isAdPlaying() {
  const now = performance.now();
  if (now - lastIsAdPlayingTime < 100) {
    return lastIsAdPlayingResult;
  }
  
  const result = _isAdPlayingInternal();
  lastIsAdPlayingResult = result;
  lastIsAdPlayingTime = now;
  return result;
}

function _isAdPlayingInternal() {
  const player = document.querySelector('#movie_player');
  if (!player) return false;

  // 1. Verificación rápida mediante clases del reproductor (muy eficiente)
  if (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')) {
    return true;
  }

  // 2. Verificación de indicadores de anuncio visibles
  const adIndicators = [
    '.ytp-ad-player-overlay',
    '.ytp-ad-text',
    '.ytp-ad-preview-text',
    '.ytp-ad-skip-button-slot',
    '.ytp-ad-module'
  ];
  
  const hasIndicator = adIndicators.some(selector => {
    const el = player.querySelector(selector);
    // Usar offsetParent para verificar visibilidad sin disparar reflow pesado
    return el && el.offsetParent !== null;
  });

  if (hasIndicator) return true;

  // 3. Verificación mediante API interna del reproductor (si está disponible)
  try {
    if (typeof player.getVideoData === 'function') {
      const data = player.getVideoData();
      if (data && (data.isAd || data.isLiveAd)) return true;
    }
    
    if (typeof player.getAdState === 'function') {
      if (player.getAdState() !== -1) return true;
    }
  } catch (e) {}

  return false;
}

let combinedSelectorCache = null;
let lastSelectorCount = 0;
let cachedShadowHosts = null;

let hideIterationCount = 0;

/**
 * Oculta elementos publicitarios del DOM
 */
function hideAdElements() {
  const startTime = performance.now();
  let hiddenCount = 0;
  hideIterationCount++;
  
  const allSelectors = [...AD_SELECTORS, ...dynamicSelectors];
  if (!combinedSelectorCache || allSelectors.length !== lastSelectorCount) {
    combinedSelectorCache = allSelectors.join(',');
    lastSelectorCount = allSelectors.length;
  }
  
  if (!cachedShadowHosts || hideIterationCount % 10 === 0) {
    const shadowHostSelectors = ['ytd-app', '#movie_player', 'ytd-player', '.html5-video-player'];
    cachedShadowHosts = shadowHostSelectors.map(s => document.querySelector(s)).filter(h => h && h.shadowRoot);
  }
  
  try {
    const elements = new Set(document.querySelectorAll(combinedSelectorCache));
    cachedShadowHosts.forEach(host => {
      host.shadowRoot.querySelectorAll(combinedSelectorCache).forEach(el => elements.add(el));
    });
    
    elements.forEach(el => {
      if (el.style.display !== 'none') {
        el.style.setProperty('display', 'none', 'important');
        if (!el.hasAttribute('data-ad-hidden')) {
          el.setAttribute('data-ad-hidden', 'true');
          hiddenCount++;
        }
      }
    });
  } catch (error) {
    debugLog('ERROR', 'Error en hideAdElements:', error);
  }
  
  if (hiddenCount > 0) {
    debugLog('INFO', `🙈 Ocultados ${hiddenCount} elementos`);
    window.notifyAdBlocked?.('elements-hidden');
  }

  const duration = performance.now() - startTime;
  if (duration > PERF_THRESHOLD) debugLog('PERF', `hideAdElements: ${duration.toFixed(2)}ms`);

  if (window.requestIdleCallback) window.requestIdleCallback(() => discoverNewAds(), { timeout: 1000 });
  else setTimeout(discoverNewAds, 500);
}

/**
 * Busca elementos que parezcan anuncios basándose en heurísticas de texto (auto-aprendizaje)
 */
function discoverNewAds() {
  const startTime = performance.now();
  const adTerms = ['Anuncio', 'Publicidad', 'Sponsored', 'Sponsoreado', 'Promocionado', 'Patrocinado'];
  
  // 1. Buscar primero elementos con badges conocidos (más rápido que texto completo)
  const knownAdBadges = document.querySelectorAll('.ytd-badge-supported-renderer:not([data-ad-checked]), [class*="badge-style-type-ad"]:not([data-ad-checked])');
  
  knownAdBadges.forEach(badge => {
    badge.setAttribute('data-ad-checked', 'true');
    // Encontrar el contenedor (renderer)
    const container = badge.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-rich-section-renderer, ytd-ad-slot-renderer');
    if (container && container.style.display !== 'none' && !container.hasAttribute('data-ad-hidden')) {
      debugLog('INFO', '🎯 Anuncio detectado por badge:', container.tagName);
      hideElementSafely(container);
    }
  });

  // 2. Heurística de texto (solo en elementos no procesados y con moderación)
  // Limitar a los primeros N elementos para evitar bloqueos prolongados
  const potentialAds = Array.from(document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-ad-slot-renderer'))
                        .filter(el => el.style.display !== 'none' && !el.hasAttribute('data-ad-hidden'))
                        .slice(0, 10); // Solo 10 por ciclo para no saturar
  
  potentialAds.forEach(el => {
    const text = el.textContent || "";
    if (adTerms.some(term => text.includes(term))) {
      debugLog('INFO', '🎯 Anuncio detectado por texto:', el.tagName);
      hideElementSafely(el);
    }
  });

  const duration = performance.now() - startTime;
  if (duration > PERF_THRESHOLD) {
    debugLog('PERF', `discoverNewAds tomó ${duration.toFixed(2)}ms`);
  }
}

/**
 * Oculta un elemento y guarda su selector si es posible
 */
function hideElementSafely(el) {
  el.style.setProperty('display', 'none', 'important');
  el.setAttribute('data-ad-hidden', 'true');
  
  const tagName = el.tagName.toLowerCase();
  let selector = '';
  
  if (el.querySelector('[class*="ad-"]') || el.querySelector('[id*="ad-"]')) {
    selector = `${tagName}:has([class*="ad-"], [id*="ad-"])`;
  } else if (el.querySelector('.ytd-badge-supported-renderer')) {
    selector = `${tagName}:has(.ytd-badge-supported-renderer)`;
  } else {
    selector = tagName;
  }

  if (selector && !AD_SELECTORS.includes(selector) && !dynamicSelectors.includes(selector)) {
    debugLog('INFO', '✨ Guardando nuevo selector dinámico:', selector);
    try {
      chrome.runtime.sendMessage({
        action: 'addDynamicRule',
        ruleType: 'selectors',
        rule: selector
      }).then(() => {
        dynamicSelectors.push(selector);
      }).catch((error) => {
        diagnosticLog('DYNAMIC_RULE_SAVE_FAILED', { selector, error: error.message });
      });
    } catch (error) {
      diagnosticLog('DYNAMIC_RULE_SEND_FAILED', { selector, error: error.message });
    }
  }
}

/**
 * Elimina overlays y popups publicitarios
 */
function removeAdOverlays() {
  const selectors = '.ytp-ad-overlay-container, .ytp-ad-text-overlay, ytd-banner-promo-renderer, ytd-statement-banner-renderer';
  document.querySelectorAll(selectors).forEach(el => el.remove());
}

/**
 * Limpia espacios vacíos dejados por anuncios bloqueados
 */
function cleanupEmptySpaces() {
  // Casi todo se maneja ahora por CSS con :has()
  // Solo verificamos contenedores que podrían haber quedado vacíos y no captados por :has()
  const startTime = performance.now();
  const adChildSelector = 'ytd-ad-slot-renderer, ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer, [class*="AdComponent"]';
  
  document.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer').forEach(container => {
    if (container.style.display !== 'none' && container.querySelector(adChildSelector)) {
      container.style.setProperty('display', 'none', 'important');
    }
  });

  const duration = performance.now() - startTime;
  if (duration > PERF_THRESHOLD) debugLog('PERF', `cleanupEmptySpaces: ${duration.toFixed(2)}ms`);
}

/**
 * Verifica si la página actual es un canal de YouTube
 */
function isChannelPage() {
  const path = window.location.pathname;
  const segments = path.split('/').filter(Boolean);

  // Patrones estándar
  if (path.startsWith('/@') ||
      path.startsWith('/channel/') ||
      path.startsWith('/user/') ||
      path.startsWith('/c/')) {
    return true;
  }

  // URLs personalizadas antiguas o sin prefijo: youtube.com/nombredelcanal
  if (segments.length > 0) {
    const reserved = [
      'watch', 'results', 'shorts', 'feed', 'playlist', 'premium',
      'settings', 'live', 'gaming', 'sports', 'news', 'fashion',
      'learning', 'revisions', 'logout', 'signin', 'ads', 'explore', 'trending'
    ];
    if (!reserved.includes(segments[0])) {
      return true;
    }
  }

  return false;
}
window.isChannelPage = isChannelPage; // Hacerlo disponible para content.js

/**
 * Verifica si la página actual es una página de búsqueda de YouTube
 */
function isSearchPage() {
  return location.pathname === '/results' || location.search.includes('search_query');
}
window.isSearchPage = isSearchPage; // Hacerlo disponible para content.js

/**
 * Estilo CSS adicional para ocultar anuncios
 */
function injectStyles() {
  if (document.getElementById('yt-adblock-styles')) return;

  const style = document.createElement('style');
  style.id = 'yt-adblock-styles';
  style.textContent = `
    /* Solo aplicar si la clase global está presente y NO estamos en un canal o búsqueda */
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) ytd-display-ad-renderer,
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) ytd-promoted-sparkles-web-renderer,
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) ytd-ad-slot-renderer,
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) .ytd-merch-shelf-renderer,
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) .video-ads,
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) .ytp-ad-module,
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) #player-ads,
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) .ytd-in-feed-ad-layout-renderer,
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) .ytd-video-masthead-ad-v3-renderer {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      min-height: 0 !important;
    }

    /* Ocultar overlays */
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) .ytp-ad-overlay-container,
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) .ytp-ad-text-overlay,
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) .ytp-ad-player-overlay-flyout-cta,
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) .ytp-ad-player-overlay-instream-info,
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) .ytp-ad-image-overlay {
      opacity: 0 !important;
      pointer-events: none !important;
      display: none !important;
    }

    /* Limpiar avisos anti-adblock */
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) ytd-enforcement-message-view-model,
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) yt-playability-error-supported-renderers {
      display: none !important;
    }

    /* Limpiar espacios vacíos (Rich Grid y otros) */
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) ytd-rich-item-renderer:has(ytd-display-ad-renderer),
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) ytd-rich-item-renderer:has(ytd-promoted-sparkles-web-renderer),
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) ytd-rich-item-renderer:has([class*="AdComponent"]),
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) ytd-rich-section-renderer:has(ytd-statement-banner-renderer),
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) ytd-rich-section-renderer:has(ytd-in-feed-ad-layout-renderer),
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) ytd-rich-section-renderer:has(ytd-ad-slot-renderer),
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) ytd-grid-video-renderer:has(ytd-ad-slot-renderer) {
      display: none !important;
    }

    /* Botón de Bypass Alternativo (yout-ube.com) */
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) .yt-adblock-bypass-btn {
      background-color: #ff0000 !important;
      color: white !important;
      border: none !important;
      padding: 8px 16px !important;
      border-radius: 18px !important;
      font-size: 14px !important;
      font-weight: 500 !important;
      cursor: pointer !important;
      margin: 8px !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 8px !important;
      transition: background-color 0.2s !important;
      font-family: inherit !important;
      text-decoration: none !important;
    }
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) .yt-adblock-bypass-btn:hover {
      background-color: #cc0000 !important;
    }
    html.yt-adblock-enabled:not(.yt-channel-page):not(.yt-search-page) .yt-adblock-bypass-btn span {
      font-size: 16px !important;
    }
  `;
  
  (document.head || document.documentElement).appendChild(style);
  debugLog('INFO', '💉 Estilos de bloqueo inyectados');
}

/**
 * Gestiona las clases en el elemento raíz para activar/desactivar estilos
 */
function updateRootClasses() {
  const isChannel = isChannelPage();
  const isSearch = isSearchPage();
  const html = document.documentElement;

  // Clase para indicar si estamos en un canal
  html.classList.toggle('yt-channel-page', isChannel);

  // Clase para indicar si estamos en una página de búsqueda
  html.classList.toggle('yt-search-page', isSearch);

  // La clase 'yt-adblock-enabled' se gestionará desde content.js basado en chrome.storage
}

// Inicializar clases y estilos
try {
  diagnosticLog('INIT_UPDATE_ROOT_CLASSES', { isChannel: isChannelPage(), isSearch: isSearchPage(), url: window.location.href });
  updateRootClasses();
} catch (e) {
  diagnosticLog('INIT_ERROR_UPDATE_ROOT_CLASSES', { error: e.message, stack: e.stack });
}

try {
  injectStyles();
  diagnosticLog('INIT_STYLES_INJECTED', { hasHead: !!document.head, hasDocumentElement: !!document.documentElement });
} catch (e) {
  diagnosticLog('INIT_ERROR_INJECT_STYLES', { error: e.message, stack: e.stack });
}

/**
 * Convierte una URL de YouTube a su versión con guion (yout-ube.com)
 */
function getHyphenatedUrl(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('youtube.com')) {
      urlObj.hostname = urlObj.hostname.replace('youtube.com', 'yout-ube.com');
      return urlObj.toString();
    }
    return url;
  } catch (e) {
    return url;
  }
}

// Exportar funciones principales
window.debugLog = debugLog;
window.skipVideoAd = skipVideoAd;
window.hideAdElements = hideAdElements;
window.removeAdOverlays = removeAdOverlays;
window.cleanupEmptySpaces = cleanupEmptySpaces;
window.isAdPlaying = isAdPlaying;
window.getHyphenatedUrl = getHyphenatedUrl;

console.log('✅ Módulo blocker.js cargado completamente');
