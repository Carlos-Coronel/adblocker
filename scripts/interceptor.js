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

  const AD_REGEX = /googleads|doubleclick|adservice|pagead|ad_break|adunit|ads\.js|\/v1\/player\/ad_break|youtube\.com\/pagead\/|googlevideo\.com\/videoplayback\?.*&adformat=/i;

  let dynamicDomains = [];
  let dynamicPatterns = [];

  // Escuchar reglas dinámicas
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'DYNAMIC_RULES_DATA') {
      const rules = event.data.rules;
      if (rules) {
        dynamicDomains = rules.domains || [];
        dynamicPatterns = (rules.patterns || []).map(p => {
          try { return new RegExp(p, 'i'); } catch(e) { return null; }
        }).filter(Boolean);
        debugLog('INFO', '📦 Reglas dinámicas cargadas');
      }
    }
  });

  function isAdUrl(url) {
    if (!url) return false;
    const urlString = String(url);
    
    if (AD_REGEX.test(urlString)) return true;
    if (dynamicDomains.some(d => urlString.includes(d))) return true;
    if (dynamicPatterns.some(p => p.test(urlString))) return true;
    
    // Heurística auto-aprendizaje
    if (urlString.includes('googlevideo.com/videoplayback') && urlString.includes('&adformat=')) {
      debugLog('INFO', '🔍 Nuevo patrón detectado:', urlString);
      const pattern = 'googlevideo\\.com\\/videoplayback\\?.*&adformat=';
      window.postMessage({ type: 'YT_AD_DETECTED', ruleType: 'patterns', rule: pattern }, '*');
      return true;
    }
    return false;
  }

  function pruneAdData(obj) {
    if (!obj || typeof obj !== 'object') return { data: obj, modified: false };
    
    const startTime = performance.now();
    const keysToPrune = ['adPlacements', 'playerAds', 'adSlots', 'adStepRenderer', 'adBreakService', 'adBreakRenderer', 'masthead', 'visitAdvertiserLink', 'interstitial', 'adBreakParams', 'adsV2', 'onTapCommand', 'adPlacement', 'playerAdRenderer'];
    const keysSet = new Set(keysToPrune);

    let nodesProcessed = 0;
    let modified = false;
    const MAX_NODES = 5000; 
    const MAX_DEPTH = 10;
    const stack = [{ o: obj, d: 0 }];

    try {
      while (stack.length > 0 && nodesProcessed++ < MAX_NODES) {
        const { o, d } = stack.pop();
        if (!o || typeof o !== 'object' || d > MAX_DEPTH) continue; 

        if (Array.isArray(o)) {
          for (let i = o.length - 1; i >= 0; i--) {
            if (o[i] && typeof o[i] === 'object') stack.push({ o: o[i], d: d + 1 });
          }
        } else {
          for (const key in o) {
            if (keysSet.has(key)) {
              const val = o[key];
              const isArr = Array.isArray(val);
              const isEmpty = isArr ? val.length === 0 : (val === null || Object.keys(val).length === 0);
              
              if (!isEmpty) {
                o[key] = isArr ? [] : {};
                modified = true;
              }
            } else {
              const val = o[key];
              if (val && typeof val === 'object') stack.push({ o: val, d: d + 1 });
            }
          }
        }
      }
    } catch (e) {
      debugLog('ERROR', 'Error en pruneAdData:', e);
    }

    const duration = performance.now() - startTime;
    if (duration > PERF_THRESHOLD) {
      debugLog('PERF', `pruneAdData: ${duration.toFixed(2)}ms, nodos: ${nodesProcessed}, modificado: ${modified}`);
    }
    return { data: obj, modified };
  }

  function notifyAdBlocked(type) {
    window.postMessage({ type: 'ADBLOCK_AD_BLOCKED', adType: type }, '*');
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
    
    const isYouTubeApi = urlString.includes('/v1/player') || urlString.includes('/v1/next');
    try {
      const response = await originalFetch.apply(this, args);
      if (isYouTubeApi && response.ok) {
        try {
          const clonedResponse = response.clone();
          let json = await clonedResponse.json();
          const result = pruneAdData(json);
          if (result.modified) {
            return new Response(JSON.stringify(result.data), {
              status: response.status, statusText: response.statusText, headers: response.headers
            });
          }
          return response;
        } catch (e) { 
          debugLog('ERROR', 'Error al procesar JSON en Fetch:', e);
          return response; 
        }
      }
      return response;
    } catch (error) { 
      if (error.name === 'AbortError') {
        debugLog('INFO', 'Fetch interceptado abortado');
      } else {
        debugLog('ERROR', 'Error en Fetch interceptado:', error);
      }
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
            const result = pruneAdData(json);
            if (result.modified) {
              const responseText = JSON.stringify(result.data);
              try {
                Object.defineProperty(xhr, 'responseText', { value: responseText, configurable: true });
              } catch (e) {
                xhr.responseText = responseText;
              }
              try {
                Object.defineProperty(xhr, 'response', { value: responseText, configurable: true });
              } catch (e) {
                xhr.response = responseText;
              }
            }
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
    let val = window[propName];
    if (val) {
      const result = pruneAdData(val);
      val = result.data;
    }

    try {
      Object.defineProperty(window, propName, {
        get: () => val,
        set: (newVal) => {
          debugLog('INFO', `📦 Variable global interceptada y podada: ${propName}`);
          const result = pruneAdData(newVal);
          val = result.data;
        },
        configurable: true,
        enumerable: true
      });
    } catch (e) {
      debugLog('WARN', `No se pudo interceptar ${propName}:`, e);
    }
  }
  interceptProp('ytInitialPlayerResponse');
  interceptProp('ytInitialData');

  console.log('✅ Interceptor de red de anuncios cargado (Main World)');
})();
