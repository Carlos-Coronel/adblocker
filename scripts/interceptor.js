// =============================================================================
// Interceptor de Red - Ejecutado en el MAIN world
// =============================================================================

(function() {
  const DEBUG_MODE = false;

  function debugLog(...args) {
    if (DEBUG_MODE) {
      console.log('[Interceptor]', ...args);
    }
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

  let dynamicDomains = [];
  let dynamicPatterns = [];

  // Escuchar reglas dinámicas
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'DYNAMIC_RULES_DATA') {
      const rules = event.data.rules;
      if (rules) {
        dynamicDomains = rules.domains || [];
        dynamicPatterns = (rules.patterns || []).map(p => {
          try { return new RegExp(p, 'i'); } catch(e) { return null; }
        }).filter(Boolean);
        debugLog('📦 Reglas dinámicas de red cargadas');
      }
    }
  });

  // Solicitar reglas dinámicas al cargar
  setTimeout(() => {
    window.postMessage({ type: 'GET_DYNAMIC_RULES' }, '*');
  }, 500);

  function isAdUrl(url) {
    if (!url) return false;
    const urlString = String(url);
    
    // 1. Verificar listas estáticas
    if (AD_DOMAINS.some(domain => urlString.includes(domain))) return true;
    if (AD_URL_PATTERNS.some(pattern => pattern.test(urlString))) return true;
    
    // 2. Verificar reglas dinámicas
    if (dynamicDomains.some(domain => urlString.includes(domain))) return true;
    if (dynamicPatterns.some(pattern => pattern.test(urlString))) return true;

    // 3. Heurística para nuevos anuncios (auto-aprendizaje)
    if (urlString.includes('youtube.com/api/stats/ads') || 
        (urlString.includes('googlevideo.com/videoplayback') && urlString.includes('&adformat='))) {
      
      // Si detectamos uno que no estaba en las listas, lo notificamos para guardarlo
      if (!dynamicPatterns.some(p => p.test(urlString))) {
        debugLog('🔍 Nuevo patrón de anuncio detectado:', urlString);
        // Intentar extraer un patrón útil (ej: el dominio o una parte fija)
        const pattern = urlString.includes('googlevideo.com') ? 
          'googlevideo\\.com\\/videoplayback\\?.*&adformat=' : 
          urlString.split('?')[0];
        
        window.postMessage({ 
          type: 'YT_AD_DETECTED', 
          ruleType: 'patterns', 
          rule: pattern 
        }, '*');
      }
      return true;
    }

    return false;
  }

  function pruneAdData(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 20) return obj;
    
    const keysToPrune = [
      'adPlacements', 'playerAds', 'adSlots', 'adStepRenderer',
      'adBreakService', 'adBreakRenderer', 'masthead',
      'visitAdvertiserLink', 'interstitial'
    ];

    if (Array.isArray(obj)) {
      // Optimización para arrays grandes: si el primer elemento no parece objeto, saltar
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
        // Solo descender si es un objeto o array
        if (val && typeof val === 'object') {
          obj[key] = pruneAdData(val, depth + 1);
        }
      }
    }
    return obj;
  }

  function notifyAdBlocked(type) {
    window.postMessage({ type: 'YT_ADBLOCK_EVENT', detail: type }, '*');
  }

  // Interceptar Fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = args[0];
    let urlString = '';
    if (typeof url === 'string') urlString = url;
    else if (url instanceof URL) urlString = url.href;
    else if (url instanceof Request) urlString = url.url;
    
    if (isAdUrl(urlString)) {
      debugLog('🚫 Request bloqueado (Fetch):', urlString);
      notifyAdBlocked('request-blocked-fetch');
      return Promise.resolve(new Response('', {
        status: 200, statusText: 'OK',
        headers: new Headers({ 'Content-Type': 'text/plain', 'X-AdBlock-Intercepted': 'true' })
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
            status: response.status, statusText: response.statusText, headers: response.headers
          });
        } catch (e) { return response; }
      }
      return response;
    } catch (error) { throw error; }
  };

  // Interceptar XMLHttpRequest
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
      debugLog('🚫 Request bloqueado (XHR):', url);
      notifyAdBlocked('request-blocked-xhr');
      setTimeout(() => {
        try {
          Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
          Object.defineProperty(xhr, 'statusText', { value: 'OK', configurable: true });
          Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
          Object.defineProperty(xhr, 'responseText', { value: '', configurable: true });
          Object.defineProperty(xhr, 'response', { value: '', configurable: true });
          xhr.dispatchEvent(new Event('readystatechange'));
          xhr.dispatchEvent(new Event('load'));
          xhr.dispatchEvent(new Event('loadend'));
        } catch (e) {}
      }, 1);
      return; 
    }
    if (url.includes('/v1/player') || url.includes('/v1/next')) {
      xhr.addEventListener('readystatechange', function() {
        if (xhr.readyState === 4 && xhr.status === 200) {
          try {
            const json = JSON.parse(xhr.responseText);
            const pruned = pruneAdData(json);
            Object.defineProperty(xhr, 'responseText', { value: JSON.stringify(pruned), configurable: true });
            Object.defineProperty(xhr, 'response', { value: JSON.stringify(pruned), configurable: true });
          } catch (e) {}
        }
      });
    }
    return originalSend.apply(this, arguments);
  };

  // Interceptar variables iniciales
  function interceptProp(propName) {
    if (window[propName]) {
      let val = pruneAdData(window[propName]);
      Object.defineProperty(window, propName, {
        get: () => val,
        set: (newVal) => { val = pruneAdData(newVal); },
        configurable: true
      });
    }
  }
  interceptProp('ytInitialPlayerResponse');
  interceptProp('ytInitialData');

  console.log('✅ Interceptor de red de anuncios cargado (Main World)');
})();
