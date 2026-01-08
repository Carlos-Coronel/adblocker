// =============================================================================
// Lógica principal de detección y bloqueo de anuncios
// =============================================================================

const DEBUG_MODE = false;

/**
 * Log personalizado para depuración (solo se muestra si DEBUG_MODE es true)
 */
function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log(...args);
  }
}

/**
 * Selectores CSS de elementos publicitarios en YouTube (CORREGIDOS)
 */
const AD_SELECTORS = [
  // Anuncios en video
  '.video-ads',
  '.ytp-ad-module',
  '.ytp-ad-overlay-container',
  '.ytp-ad-text-overlay',
  '.ytp-ad-player-overlay',
  
  // Anuncios en la página
  'ytd-display-ad-renderer',
  'ytd-promoted-sparkles-web-renderer',
  'ytd-statement-banner-renderer',
  'ytd-banner-promo-renderer',
  'ytd-action-companion-ad-renderer',
  'ytd-video-masthead-ad-v3-renderer',
  'ytd-companion-slot-renderer',
  'ytd-in-feed-ad-layout-renderer',
  'ytd-player-legacy-desktop-watch-ads-renderer',
  
  // Anuncios en búsqueda y miniaturas
  '.ytd-search-pyv-renderer',
  'ytd-ad-slot-renderer',
  'yt-mealbar-promo-renderer',
  'yt-interaction-companion-ad-renderer',
  
  // Overlays y banners
  '.ytd-popup-container',
  '.ytd-promoted-video-renderer',
  '#player-ads',
  '.ytd-merch-shelf-renderer',
  'ytd-ad-engagement-panel-renderer',
  
  // Bloqueo de avisos anti-adblock
  'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)',
  'yt-playability-error-supported-renderers:has(ytd-enforcement-message-view-model)',
  
  // Anuncios patrocinados - CORREGIDOS (más específicos)
  '[class*="paid-content"]',
  '[class*="advertisement"]',
  '[aria-label*="Advertisement"]',
  '[aria-label*="Sponsorship"]',
  'ytd-ad-slot-renderer',
  'ytd-in-feed-ad-layout-renderer',
  'ad-button-view-model',
  'top-landscape-image-layout-view-model',
  '[class*="AdComponentHost"]',
  '.ytp-ad-survey-container',
  '.ytp-ad-action-interstitial',
  '[id^="ad-text:"]',
  '.ytp-ad-message-container',
  'ytd-ad-engagement-panel-renderer'
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
      debugLog('📦 Selectores dinámicos cargados:', dynamicSelectors.length);
    }
  } catch (e) {
    // Silenciar errores en contextos restringidos
  }
}

// Intentar cargar al inicio
loadDynamicSelectors();

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
      debugLog('⏭️ Saltando anuncio de video (botón)');
      skipButton.click();
      window.notifyAdBlocked?.('video-ad-skipped');
      return true;
    }
    
    // 2. Si hay un anuncio activo, acelerarlo y adelantarlo
    if (video && adActive) {
      // Mute y aceleración (técnica muy efectiva y menos propensa a bloqueos)
      if (!video.muted) video.muted = true;
      if (video.playbackRate < 10) video.playbackRate = 16;
      
      if (typeof video.duration === 'number' && !isNaN(video.duration) && video.duration > 0 && video.duration !== Infinity) {
        // BUCLE FIX: Solo adelantamos si no estamos ya cerca del final
        // Esto evita que se asigne el mismo valor repetidamente
        if (video.currentTime < video.duration - 0.5) {
          video.currentTime = video.duration;
          debugLog('⏩ Adelantando anuncio al final');
          window.notifyAdBlocked?.('video-ad-fast-forward');
          return true;
        }
      } else {
        // Si no tenemos duración, al menos pausamos si es necesario
        if (!video.paused) {
          video.pause();
          debugLog('⏸️ Pausando anuncio de video (duración desconocida)');
          window.notifyAdBlocked?.('video-ad-paused');
          return true;
        }
      }
    } else if (video && video.playbackRate === 16 && !adActive) {
      // Restaurar velocidad si el anuncio terminó y quedó en 16x
      video.playbackRate = 1;
      video.muted = false;
      debugLog('▶️ Restaurando velocidad normal');
    }
    
    return false;
  } catch (error) {
    console.error('Error en skipVideoAd:', error);
    return false;
  }
}

/**
 * Verifica si hay un anuncio reproduciéndose
 */
function isAdPlaying() {
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

/**
 * Oculta elementos publicitarios del DOM
 */
function hideAdElements() {
  let hiddenCount = 0;
  
  const selectors = [...AD_SELECTORS, ...dynamicSelectors];
  const shadowHosts = ['ytd-app', '#movie_player', 'ytd-player', '.html5-video-player'];
  const hosts = shadowHosts.map(s => document.querySelector(s)).filter(h => h && h.shadowRoot);
  
  selectors.forEach(selector => {
    try {
      // Buscar en el documento principal
      let elements = Array.from(document.querySelectorAll(selector));
      
      // Buscar en Shadow DOM de contenedores críticos (YouTube los usa mucho)
      hosts.forEach(host => {
        try {
          const shadowElements = host.shadowRoot.querySelectorAll(selector);
          if (shadowElements.length > 0) {
            elements = elements.concat(Array.from(shadowElements));
          }
        } catch (e) {}
      });
      
      elements.forEach(element => {
        if (element && element.style.display !== 'none') {
          element.style.setProperty('display', 'none', 'important');
          element.style.setProperty('visibility', 'hidden', 'important');
          
          // Marcar como procesado para evitar logs repetitivos
          if (!element.hasAttribute('data-ad-hidden')) {
            element.setAttribute('data-ad-hidden', 'true');
            hiddenCount++;
          }
        }
      });
    } catch (error) {
      // Silenciar errores de selectores inválidos
    }
  });
  
  if (hiddenCount > 0) {
    debugLog(`🙈 Ocultados ${hiddenCount} elementos publicitarios`);
    window.notifyAdBlocked?.('elements-hidden');
  }

  // Ejecutar descubrimiento de nuevos anuncios (aprendizaje dinámico) con requestIdleCallback si es posible
  if (window.requestIdleCallback) {
    window.requestIdleCallback(() => discoverNewAds(), { timeout: 500 });
  } else {
    setTimeout(discoverNewAds, 100);
  }
}

/**
 * Busca elementos que parezcan anuncios basándose en heurísticas de texto (auto-aprendizaje)
 */
function discoverNewAds() {
  const adTerms = ['Anuncio', 'Publicidad', 'Sponsored', 'Sponsoreado', 'Promocionado', 'Patrocinado'];
  // Solo buscar en elementos que suelen ser contenedores de anuncios
  const potentialAds = document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-rich-section-renderer, ytd-ad-slot-renderer');
  
  potentialAds.forEach(el => {
    if (el.style.display === 'none' || el.hasAttribute('data-ad-hidden')) return;
    
    // Heurística de texto: buscar marcas de anuncios (usar textContent es más rápido que innerText)
    const textContent = el.textContent || "";
    const hasAdTerm = adTerms.some(term => textContent.includes(term));
    
    if (hasAdTerm) {
      debugLog('🎯 Nuevo anuncio potencial detectado por heurística:', el);
      
      // Ocultar inmediatamente
      el.style.setProperty('display', 'none', 'important');
      el.setAttribute('data-ad-hidden', 'true');
      
      // Intentar identificar un selector robusto
      const tagName = el.tagName.toLowerCase();
      let selector = '';
      
      if (el.querySelector('[class*="ad-"]') || el.querySelector('[id*="ad-"]')) {
        selector = `${tagName}:has([class*="ad-"], [id*="ad-"])`;
      } else if (el.querySelector('.ytd-badge-supported-renderer')) {
         selector = `${tagName}:has(.ytd-badge-supported-renderer)`;
      } else {
        // Selector genérico si no hay nada más específico
        selector = tagName;
      }

      // Notificar al background si es nuevo y no está en las listas estáticas
      if (selector && !AD_SELECTORS.includes(selector) && !dynamicSelectors.includes(selector)) {
        debugLog('✨ Guardando nuevo selector dinámico:', selector);
        chrome.runtime.sendMessage({
          action: 'addDynamicRule',
          ruleType: 'selectors',
          rule: selector
        }).catch(() => {});
        dynamicSelectors.push(selector);
      }
    }
  });
}

/**
 * Elimina overlays y popups publicitarios
 */
function removeAdOverlays() {
  try {
    // Overlays de anuncios en el reproductor
    const overlays = document.querySelectorAll(
      '.ytp-ad-overlay-container, .ytp-ad-text-overlay'
    );
    
    overlays.forEach(overlay => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
        debugLog('🗑️ Overlay publicitario eliminado');
        window.notifyAdBlocked?.('overlay-removed');
      }
    });
    
    // Banners de promoción
    const banners = document.querySelectorAll(
      'ytd-banner-promo-renderer, ytd-statement-banner-renderer'
    );
    
    banners.forEach(banner => {
      if (banner.parentNode) {
        banner.parentNode.removeChild(banner);
        debugLog('🗑️ Banner publicitario eliminado');
      }
    });
  } catch (error) {
    console.error('Error en removeAdOverlays:', error);
  }
}

/**
 * Limpia espacios vacíos dejados por anuncios bloqueados
 */
function cleanupEmptySpaces() {
  const containers = document.querySelectorAll(
    'ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-rich-section-renderer'
  );
  
  containers.forEach(container => {
    // 1. Verificar si contiene elementos explícitos de anuncios
    const adChildren = container.querySelectorAll('ytd-ad-slot-renderer, ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer, [class*="AdComponent"]');
    if (adChildren.length > 0) {
      container.style.setProperty('display', 'none', 'important');
      return;
    }

    // 2. Si el contenedor no tiene contenido visual legítimo, ocultarlo
    const hasVisibleContent = container.querySelector('img, video, [class*="thumbnail"], #video-title');
    if (!hasVisibleContent) {
      // Verificar si hay texto que no sea solo "Patrocinado" o similar
      const text = container.textContent?.trim() || "";
      if (text === "" || text.includes("Patrocinado") || text.includes("Sponsored") || text.length < 5) {
        container.style.setProperty('display', 'none', 'important');
      }
    }
  });
}

/**
 * Intercepta y modifica objetos JSON para eliminar datos de anuncios (JSON Pruning)
 */
function pruneAdData(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 20) return obj;

  const keysToPrune = [
    'adPlacements', 'playerAds', 'adSlots', 'adStepRenderer',
    'adBreakService', 'adBreakRenderer', 'masthead',
    'visitAdvertiserLink', 'interstitial'
  ];

  if (Array.isArray(obj)) {
    if (obj.length > 50 && obj[0] && typeof obj[0] !== 'object') return obj;
    for (let i = 0; i < obj.length; i++) {
      obj[i] = pruneAdData(obj[i], depth + 1);
    }
    return obj;
  }

  for (const key in obj) {
    if (keysToPrune.includes(key)) {
      if (Array.isArray(obj[key])) obj[key] = [];
      else if (typeof obj[key] === 'object' && obj[key] !== null) obj[key] = {};
      else delete obj[key];
    } else {
      const val = obj[key];
      if (val && typeof val === 'object') {
        obj[key] = pruneAdData(val, depth + 1);
      }
    }
  }
  return obj;
}

const AD_DOMAINS = [
  'googleads.g.doubleclick.net',
  'static.doubleclick.net',
  'googleadservices.com',
  'googlesyndication.com',
  'googleads4.g.doubleclick.net',
  'adservice.google.com',
  'doubleclick.net',
  'pagead2.googlesyndication.com',
  'ad.doubleclick.net',
  'securepubads.g.doubleclick.net',
  'stats.g.doubleclick.net',
  'cm.g.doubleclick.net'
];

/**
 * Patrones de URL conocidos por servir anuncios o telemetría
 */
const AD_URL_PATTERNS = [
  /googleads/i,
  /doubleclick/i,
  /adservice/i,
  /pagead/i,
  /ptracking/i,
  /ad_break/i,
  /adunit/i,
  /ads\.js/i,
  /\/v1\/player\/ad_break/i,
  /\/api\/stats\/ads/i,
  /youtube\.com\/pagead\//i,
  /googlevideo\.com\/videoplayback\?.*&adformat=/i
];

/**
 * Verifica si una URL coincide con algún filtro de anuncios
 */
function isAdUrl(url) {
  if (!url) return false;
  const urlString = String(url);
  
  // Verificar dominios
  if (AD_DOMAINS.some(domain => urlString.includes(domain))) {
    return true;
  }
  
  // Verificar patrones regex
  if (AD_URL_PATTERNS.some(pattern => pattern.test(urlString))) {
    return true;
  }
  
  return false;
}

/**
 * Bloquea requests de anuncios y limpia respuestas JSON (DEPURADO - Movido a interceptor.js para MAIN world)
 */
(function setupInterceptors() {
  // Ocultar huellas de automatización/extensión (mantenemos esto en el isolated world si es necesario, 
  // aunque es mejor en el main world. Por ahora lo dejamos vacío o lo movemos).
  try {
    // Mocks adicionales para estabilidad y anti-detección
    window.canRunAds = true;
    window.google_ad_status = 1;
  } catch (e) {}
})();

/**
 * Estilo CSS adicional para ocultar anuncios
 */
(function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* Ocultar contenedores de anuncios */
    ytd-display-ad-renderer,
    ytd-promoted-sparkles-web-renderer,
    ytd-ad-slot-renderer,
    .ytd-merch-shelf-renderer,
    .video-ads,
    .ytp-ad-module,
    #player-ads {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      min-height: 0 !important;
    }
    
    /* Ocultar overlays */
    .ytp-ad-overlay-container,
    .ytp-ad-text-overlay,
    .ytp-ad-player-overlay-flyout-cta,
    .ytp-ad-player-overlay-instream-info,
    .ytp-ad-image-overlay {
      opacity: 0 !important;
      pointer-events: none !important;
      display: none !important;
    }
    
    /* Limpiar avisos anti-adblock */
    ytd-enforcement-message-view-model,
    yt-playability-error-supported-renderers {
      display: none !important;
    }
    
    /* Limpiar espacios vacíos (Rich Grid y otros) */
    ytd-rich-item-renderer:has(ytd-display-ad-renderer),
    ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
    ytd-rich-item-renderer:has(ytd-promoted-sparkles-web-renderer),
    ytd-rich-item-renderer:has([class*="AdComponent"]),
    ytd-rich-section-renderer:has(ytd-statement-banner-renderer),
    ytd-rich-section-renderer:has(ytd-in-feed-ad-layout-renderer),
    ytd-rich-section-renderer:has(ytd-ad-slot-renderer),
    ytd-grid-video-renderer:has(ytd-ad-slot-renderer) {
      display: none !important;
    }

    /* Botón de Bypass Alternativo (yout-ube.com) */
    .yt-adblock-bypass-btn {
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
    .yt-adblock-bypass-btn:hover {
      background-color: #cc0000 !important;
    }
    .yt-adblock-bypass-btn span {
      font-size: 16px !important;
    }
  `;
  
  (document.head || document.documentElement).appendChild(style);
  debugLog('💉 Estilos de bloqueo inyectados');
})();

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
