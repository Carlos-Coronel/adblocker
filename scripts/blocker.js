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
  const adIndicators = [
    '.ytp-ad-player-overlay',
    '.ytp-ad-text',
    '.ad-showing',
    '.ad-interrupting',
    '.ytp-ad-preview-text',
    '.ytp-ad-skip-button-slot',
    '.ytp-ad-module'
  ];
  
  const hasIndicator = adIndicators.some(selector => {
    // Buscar elemento directamente
    const el = document.querySelector(selector);
    if (el) {
      // Verificar si el elemento es visible y tiene dimensiones
      const style = window.getComputedStyle(el);
      if (style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0) {
        return true;
      }
    }
    
    // Buscar como clase en el contenedor del reproductor
    if (selector.startsWith('.') && player && player.classList.contains(selector.substring(1))) {
      return true;
    }
    
    return false;
  });

  if (hasIndicator) return true;

  // Verificación adicional mediante API interna del reproductor si está disponible
  try {
    if (player && typeof player.getVideoData === 'function') {
      const data = player.getVideoData();
      if (data && (data.isAd || data.isLiveAd)) return true;
    }
    
    // Verificar si el estado del reproductor indica anuncio
    if (player && typeof player.getAdState === 'function') {
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
  
  AD_SELECTORS.forEach(selector => {
    try {
      // Buscar en el documento principal
      let elements = Array.from(document.querySelectorAll(selector));
      
      // Buscar en Shadow DOM de contenedores críticos (YouTube los usa mucho)
      const shadowHosts = ['ytd-app', '#movie_player', 'ytd-player', '.html5-video-player'];
      shadowHosts.forEach(hostSelector => {
        try {
          const host = document.querySelector(hostSelector);
          if (host && host.shadowRoot) {
            const shadowElements = host.shadowRoot.querySelectorAll(selector);
            elements = elements.concat(Array.from(shadowElements));
          }
        } catch (e) {}
      });
      
      elements.forEach(element => {
        if (element && element.style.display !== 'none') {
          element.style.setProperty('display', 'none', 'important');
          element.style.setProperty('visibility', 'hidden', 'important');
          element.style.setProperty('height', '0', 'important');
          element.style.setProperty('width', '0', 'important');
          element.style.setProperty('position', 'absolute', 'important');
          element.style.setProperty('opacity', '0', 'important');
          
          // Marcar como procesado para evitar logs repetitivos
          if (!element.hasAttribute('data-ad-hidden')) {
            element.setAttribute('data-ad-hidden', 'true');
            hiddenCount++;
          }
        }
      });
    } catch (error) {
      debugLog(`Error con selector ${selector}:`, error);
    }
  });
  
  if (hiddenCount > 0) {
    debugLog(`🙈 Ocultados ${hiddenCount} nuevos elementos publicitarios`);
    window.notifyAdBlocked?.('elements-hidden');
  }
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
      const text = container.innerText?.trim() || "";
      if (text === "" || text.includes("Patrocinado") || text.includes("Sponsored") || text.length < 5) {
        container.style.setProperty('display', 'none', 'important');
      }
    }
  });
}

/**
 * Intercepta y modifica objetos JSON para eliminar datos de anuncios (JSON Pruning)
 */
function pruneAdData(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  const keysToPrune = [
    'adPlacements',
    'playerAds',
    'adSlots',
    'adStepRenderer',
    'adBreakService',
    'adBreakRenderer',
    'masthead',
    'visitAdvertiserLink',
    'interstitial'
  ];

  if (Array.isArray(obj)) {
    return obj.map(item => pruneAdData(item));
  }

  for (const key in obj) {
    if (keysToPrune.includes(key)) {
      // console.log(`✂️ Podando propiedad de anuncio: ${key}`);
      if (Array.isArray(obj[key])) {
        obj[key] = [];
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        obj[key] = {};
      } else {
        delete obj[key];
      }
    } else {
      obj[key] = pruneAdData(obj[key]);
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
 * Bloquea requests de anuncios y limpia respuestas JSON (CORREGIDO)
 */
(function setupInterceptors() {
  // 1. Interceptar Fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = args[0];
    let urlString = '';

    if (typeof url === 'string') {
      urlString = url;
    } else if (url instanceof URL) {
      urlString = url.href;
    } else if (url instanceof Request) {
      urlString = url.url;
    }
    
    if (isAdUrl(urlString)) {
      debugLog('🚫 Request publicitario bloqueado (Fetch):', urlString);
      window.notifyAdBlocked?.('request-blocked');
      // Devolver una respuesta vacía exitosa para evitar reintentos infinitos
      return Promise.resolve(new Response('', {
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 
          'Content-Type': 'text/plain',
          'X-AdBlock-Intercepted': 'true' 
        })
      }));
    }
    
    const isYouTubeApi = urlString.includes('/v1/player') || urlString.includes('/v1/next') || urlString.includes('/v1/browse');
    
    try {
      const response = await originalFetch.apply(this, args);
      if (isYouTubeApi && response.ok) {
        try {
          const clonedResponse = response.clone();
          let json = await clonedResponse.json();
          json = pruneAdData(json);
          
          return new Response(JSON.stringify(json), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        } catch (e) {
          return response;
        }
      }
      return response;
    } catch (error) {
      // Re-lanzar error si la petición original falló
      throw error;
    }
  };

  // 2. Interceptar XMLHttpRequest
  const originalXHR = window.XMLHttpRequest.prototype.open;
  window.XMLHttpRequest.prototype.open = function(method, url) {
    this._url = url;
    return originalXHR.apply(this, arguments);
  };

  const originalSend = window.XMLHttpRequest.prototype.send;
  window.XMLHttpRequest.prototype.send = function() {
    const xhr = this;
    const url = xhr._url || '';
    
    if (isAdUrl(url)) {
      debugLog('🚫 Request publicitario bloqueado (XHR):', url);
      window.notifyAdBlocked?.('request-blocked');
      
      // Simular éxito de red de forma asíncrona para evitar reintentos de YouTube
      setTimeout(() => {
        try {
          // Forzar estado de completado exitoso
          Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
          Object.defineProperty(xhr, 'statusText', { value: 'OK', configurable: true });
          Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
          Object.defineProperty(xhr, 'responseText', { value: '', configurable: true });
          Object.defineProperty(xhr, 'response', { value: '', configurable: true });
          
          xhr.dispatchEvent(new Event('readystatechange'));
          xhr.dispatchEvent(new Event('load'));
          xhr.dispatchEvent(new Event('loadend'));
        } catch (e) {
          debugLog('Error simulando éxito XHR:', e);
        }
      }, 1);
      return; 
    }

    if (url.includes('/v1/player') || url.includes('/v1/next')) {
      xhr.addEventListener('readystatechange', function() {
        if (xhr.readyState === 4 && xhr.status === 200) {
          try {
            const json = JSON.parse(xhr.responseText);
            const pruned = pruneAdData(json);
            Object.defineProperty(xhr, 'responseText', { value: JSON.stringify(pruned) });
            Object.defineProperty(xhr, 'response', { value: JSON.stringify(pruned) });
          } catch (e) {}
        }
      });
    }
    
    return originalSend.apply(this, arguments);
  };

  // 3. Interceptar variables iniciales
  function interceptProp(propName) {
    let val = pruneAdData(window[propName]);
    Object.defineProperty(window, propName, {
      get: () => val,
      set: (newVal) => {
        val = pruneAdData(newVal);
      },
      configurable: true
    });
  }

  interceptProp('ytInitialPlayerResponse');
  interceptProp('ytInitialData');

  // 4. Mock de telemetría y publicidad para evitar detección y errores
  try {
    window.ga = window.ga || function() {};
    window._gaq = window._gaq || [];
    window.google_analytics_low_priority_async = true;
    
    // Mocks adicionales para estabilidad y anti-detección
    window.canRunAds = true;
    window.google_ad_status = 1;
    window.ytpubads = window.ytpubads || {};
    window.adsbygoogle = window.adsbygoogle || [];
    window.adsbygoogle.loaded = true;
    
    // Ocultar huellas de automatización/extensión
    try {
      if (navigator.webdriver) {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      }
    } catch (e) {}

    // Simular que el objeto de configuración de anuncios de YT existe
    if (window.yt) {
      window.yt.ads_ = window.yt.ads_ || {};
      window.yt.adsConfig_ = window.yt.adsConfig_ || { adAllowed: false };
    }
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
