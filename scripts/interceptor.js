// =============================================================================
// Interceptor de Red - Ejecutado en el MAIN world
// =============================================================================

(function() {
  const DEBUG_MODE = true;
  const PERF_THRESHOLD = 10; // ms

  function debugLog(level, ...args) {
    if (DEBUG_MODE) {
      const timestamp = new Date().toISOString().split('T')[1].split('Z')[0];
      const prefix = `[Interceptor][${timestamp}][${level}]`;
      if (level === 'ERROR') console.error(prefix, ...args);
      else if (level === 'WARN') console.warn(prefix, ...args);
      else if (level === 'PERF') console.debug(prefix, ...args);
      else console.log(prefix, ...args);
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
        debugLog('INFO', '📦 Reglas dinámicas de red cargadas');
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
        debugLog('INFO', '🔍 Nuevo patrón de anuncio detectado:', urlString);
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

  function pruneAdData(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    
    const startTime = performance.now();
    const keysToPrune = [
      'adPlacements', 'playerAds', 'adSlots', 'adStepRenderer',
      'adBreakService', 'adBreakRenderer', 'masthead',
      'visitAdvertiserLink', 'interstitial'
    ];

    let nodesProcessed = 0;
    const MAX_NODES = 20000; // Límite de seguridad
    const stack = [{ o: obj, d: 0 }];

    try {
      while (stack.length > 0 && nodesProcessed < MAX_NODES) {
        const { o, d } = stack.pop();
        nodesProcessed++;

        if (!o || typeof o !== 'object' || d > 15) continue;

        if (Array.isArray(o)) {
          // Optimización: Si es un array muy grande de tipos primitivos, no procesar
          if (o.length > 100 && typeof o[0] !== 'object' && o[0] !== null) continue;
          
          for (let i = o.length - 1; i >= 0; i--) {
            if (o[i] && typeof o[i] === 'object') {
              stack.push({ o: o[i], d: d + 1 });
            }
          }
        } else {
          for (const key in o) {
            if (keysToPrune.includes(key)) {
              if (Array.isArray(o[key])) o[key] = [];
              else if (typeof o[key] === 'object' && o[key] !== null) o[key] = {};
              else delete o[key];
            } else {
              const val = o[key];
              if (val && typeof val === 'object') {
                stack.push({ o: val, d: d + 1 });
              }
            }
          }
        }
      }
    } catch (e) {
      debugLog('ERROR', 'Error en pruneAdData:', e);
    }

    const duration = performance.now() - startTime;
    if (duration > PERF_THRESHOLD) {
      debugLog('PERF', `pruneAdData tomó ${duration.toFixed(2)}ms (${nodesProcessed} nodos)`);
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
      debugLog('INFO', '🚫 Request bloqueado (Fetch):', urlString);
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
        } catch (e) { 
          debugLog('ERROR', 'Error al procesar JSON en Fetch:', e);
          return response; 
        }
      }
      return response;
    } catch (error) { 
      debugLog('ERROR', 'Error en Fetch interceptado:', error);
      throw error; 
    }
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
      debugLog('INFO', '🚫 Request bloqueado (XHR):', url);
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
          } catch (e) {
            debugLog('ERROR', 'Error al procesar JSON en XHR:', e);
          }
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
