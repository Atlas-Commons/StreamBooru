/* StreamBooru platform adapter for Electron (desktop) and Capacitor (Android)
   - Supplies window.api on Android/Web
*/
(function () {
  // env
  const isElectron = () => navigator.userAgent.includes('Electron');
  const C = typeof window !== 'undefined' ? window.Capacitor : undefined;
  const isAndroid = () => !!C && typeof C.getPlatform === 'function' && C.getPlatform() === 'android';
  const isWebBrowser = () => !isElectron() && !isAndroid();
  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
    } catch { return ''; }
  }
  function defaultOriginBase() {
    if (typeof window === 'undefined' || !window.location?.origin) return '';
    const origin = window.location.origin.replace(/\/+$/, '');
    if (window.location.pathname.startsWith('/app')) return origin;
    return '';
  }
  function webOAuthRedirect() {
    const base = defaultOriginBase() || (typeof window !== 'undefined' ? window.location.origin.replace(/\/+$/, '') : '');
    return `${base}/oauth-callback`;
  }
  function buildDiscordLoginUrl() {
    const acc = accLoad();
    let base = accGetBase(acc);
    if (!base && isWebBrowser()) {
      base = defaultOriginBase();
      if (base) { acc.serverBase = base; accSave(acc); }
    }
    if (!base) return { ok: false, error: 'No server selected' };
    const url = `${base}/auth/discord?redirect_uri=${encodeURIComponent(webOAuthRedirect())}`;
    return { ok: true, url, base };
  }
  function openWebOAuth(url) {
    // Same-tab redirect is the most reliable path in browsers (popups are often blocked silently).
    window.location.assign(url);
    return { ok: true, pending: true, mode: 'redirect' };
  }
  function accountBeginDiscordLogin() {
    const built = buildDiscordLoginUrl();
    if (!built.ok) return built;
    if (!isWebBrowser()) return { ok: false, error: 'Not supported in this client' };
    return openWebOAuth(built.url);
  }

  // native HTTP
  const UA = 'Mozilla/5.0 StreamBooru/1.1 (+https://github.com/Atlas-Commons/StreamBooru)';
  function getHttp() { return C?.Plugins?.CapacitorHttp || C?.Plugins?.Http || null; }
  function originFrom(url) { try { return new URL(url).origin; } catch { return ''; } }
  const b64 = (s) => { try { return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'utf8').toString('base64'); } catch { return s; } };
  // chunked to avoid per-byte string concat and fromCharCode arg limits
  function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return b64(bin);
  }

  // Tiny event bus used by renderer
  const Events = (() => {
    const map = new Map();
    const on = (ev, fn) => { if (!map.has(ev)) map.set(ev, new Set()); map.get(ev).add(fn); };
    const off = (ev, fn) => { map.get(ev)?.delete(fn); };
    const emit = (ev, payload) => { (map.get(ev) || new Set()).forEach((fn)=>{ try { fn(payload); } catch {} }); };
    return {
      on, off, emit,
      onFavoritesChanged: (fn) => on('favorites_changed', fn),
      onConfigChanged: (fn) => on('config_changed', fn),
      onAccountChanged: (fn) => on('account_changed', fn),
      emitAccountChanged: () => emit('account_changed', {}),
      onDownloadProgress: (fn) => on('download_progress', fn)
    };
  })();
  window.events = window.events || Events;

  // Global image preconnects for speed
  (function injectPreconnects() {
    const hosts = [
      'https://cdn.donmai.us', 'https://danbooru.donmai.us',
      'https://files.yande.re', 'https://konachan.com', 'https://konachan.net',
      'https://gelbooru.com', 'https://safebooru.org',
      'https://derpicdn.net', 'https://derpibooru.org',
      'https://e621.net'
    ];
    for (const href of hosts) {
      if (document.head.querySelector(`link[rel="preconnect"][href="${href}"]`)) continue;
      const l = document.createElement('link');
      l.rel = 'preconnect'; l.href = href; l.crossOrigin = '';
      document.head.appendChild(l);
    }
  })();

  // HTTP helpers
  function webProxyBase() {
    if (isElectron()) return '';
    const acc = typeof accLoad === 'function' ? accLoad() : {};
    return accGetBase(acc) || defaultOriginBase() || (isAndroid() ? 'https://streambooru.ecchibooru.uk' : '');
  }
  async function fetchViaBooruProxy(url, accept) {
    const base = webProxyBase();
    if (!base) return null;
    const proxy = `${base}/api/booru/fetch?url=${encodeURIComponent(url)}&accept=${encodeURIComponent(accept)}`;
    const r = await fetch(proxy, { headers: { Accept: accept } });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r;
  }
  function isSyncServerUrl(url) {
    try {
      const base = webProxyBase() || window.location.origin;
      const target = new URL(url, base);
      const server = new URL(base, window.location.origin);
      return target.origin === server.origin;
    } catch {
      return false;
    }
  }
  async function httpGetJSON(url, headers = {}) {
    const Http = getHttp();
    if (isAndroid() && Http?.get) {
      const res = await Http.get({
        url,
        headers: { Accept: 'application/json', 'User-Agent': UA, Referer: originFrom(url), ...headers },
        readTimeout: 15000,
        connectTimeout: 15000
      });
      const status = res.status ?? 0;
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status} for ${url}`);
      let data = res.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch {} }
      return data;
    }
    if (isWebBrowser() && !isSyncServerUrl(url)) {
      try {
        const r = await fetchViaBooruProxy(url, 'application/json');
        if (r) return r.json();
      } catch (e) {
        console.warn('booru proxy json failed, trying direct', e?.message || e);
      }
    }
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA, ...headers } });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.json();
  }
  async function httpGetText(url, headers = {}) {
    const Http = getHttp();
    if (isAndroid() && Http?.get) {
      const res = await Http.get({
        url,
        responseType: 'text',
        headers: { 'User-Agent': UA, Referer: originFrom(url), ...headers },
        readTimeout: 30000,
        connectTimeout: 20000
      });
      const status = res.status ?? 0;
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status} for ${url}`);
      return String(res.data ?? '');
    }
    if (isWebBrowser() && !isSyncServerUrl(url)) {
      try {
        const r = await fetchViaBooruProxy(url, 'text/plain, application/xml, text/xml, */*');
        if (r) return r.text();
      } catch (e) {
        console.warn('booru proxy text failed, trying direct', e?.message || e);
      }
    }
    const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.text();
  }
  async function httpPostJSON(url, body = {}, headers = {}) {
    const Http = getHttp();
    if (isAndroid() && Http?.post) {
      const res = await Http.post({
        url,
        data: body,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA, Referer: originFrom(url), ...headers },
        readTimeout: 30000,
        connectTimeout: 20000
      });
      const status = res.status ?? 0;
      let data = res.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch {} }
      return { status, json: data };
    }
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA, ...headers }, body: JSON.stringify(body || {}) });
    let json = null; try { json = await resp.json(); } catch {}
    return { status: resp.status || 0, json };
  }
  async function httpPutJSON(url, body = {}, headers = {}) {
    const Http = getHttp();
    if (isAndroid() && Http?.put) {
      const res = await Http.put({
        url,
        data: body,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA, Referer: originFrom(url), ...headers },
        readTimeout: 30000,
        connectTimeout: 20000
      });
      const status = res.status ?? 0;
      let data = res.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch {} }
      return { status, json: data };
    }
    const resp = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA, ...headers }, body: JSON.stringify(body || {}) });
    let json = null; try { json = await resp.json(); } catch {}
    return { status: resp.status || 0, json };
  }
  async function httpDelete(url, headers = {}) {
    const Http = getHttp();
    if (isAndroid() && Http?.delete) {
      const res = await Http.delete({
        url,
        headers: { 'User-Agent': UA, Referer: originFrom(url), ...headers },
        readTimeout: 20000,
        connectTimeout: 15000
      });
      const status = res.status ?? 0;
      let data = res.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch {} }
      return { status, json: data };
    }
    const resp = await fetch(url, { method: 'DELETE', headers: { 'User-Agent': UA, ...headers } });
    let json = null; try { json = await resp.json(); } catch {}
    return { status: resp.status || 0, json };
  }

  // Image fetch helpers (Referer/Origin for hotlinking)
  const hostMatches = (host, domain) => host === domain || host.endsWith(`.${domain}`);
  const HOTLINK_HOSTS = ['donmai.us', 'yande.re', 'konachan.com', 'konachan.net', 'e621.net', 'e926.net',
    'e621.media', 'e926.media', 'derpibooru.org', 'derpicdn.net', 'gelbooru.com',
    'safebooru.org', 'rule34.xxx', 'realbooru.com', 'xbooru.com', 'tbib.org', 'hypnohub.net'];
  function isHotlinkHost(u) {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return HOTLINK_HOSTS.some((domain) => hostMatches(h, domain));
    } catch { return false; }
  }
  window.isHotlinkHost = isHotlinkHost;
  function refererFor(url) {
    try {
      const h = new URL(url).hostname.toLowerCase();
      if (hostMatches(h, 'donmai.us')) return 'https://danbooru.donmai.us';
      if (hostMatches(h, 'yande.re')) return 'https://yande.re';
      if (hostMatches(h, 'konachan.com')) return 'https://konachan.com';
      if (hostMatches(h, 'konachan.net')) return 'https://konachan.net';
      if (hostMatches(h, 'hypnohub.net')) return 'https://hypnohub.net';
      if (hostMatches(h, 'tbib.org')) return 'https://tbib.org';
      if (hostMatches(h, 'gelbooru.com')) return 'https://gelbooru.com';
      if (hostMatches(h, 'safebooru.org')) return 'https://safebooru.org';
      if (hostMatches(h, 'e621.net') || hostMatches(h, 'e621.media')) return 'https://e621.net';
      if (hostMatches(h, 'e926.net') || hostMatches(h, 'e926.media')) return 'https://e926.net';
      if (hostMatches(h, 'derpicdn.net') || hostMatches(h, 'derpibooru.org')) return 'https://derpibooru.org';
      return '';
    } catch { return ''; }
  }
  // LRU cache for proxied images (data URLs)
  const IMG_CACHE_MAX = 400;
  const imgCache = new Map();
  function cacheGet(k) {
    const v = imgCache.get(k);
    if (v) { imgCache.delete(k); imgCache.set(k, v); }
    return v || null;
  }
  function cachePut(k, v) {
    if (imgCache.has(k)) imgCache.delete(k);
    imgCache.set(k, v);
    if (imgCache.size > IMG_CACHE_MAX) {
      const it = imgCache.keys().next();
      if (!it.done) imgCache.delete(it.value);
    }
  }

  // Concurrency limiter for proxyImage
  const MAX_CONC = 8;
  let inFlight = 0;
  const waitQ = [];
  function acquire() {
    return new Promise((resolve) => {
      if (inFlight < MAX_CONC) { inFlight++; resolve(); }
      else waitQ.push(resolve);
    });
  }
  function release() {
    inFlight--;
    const next = waitQ.shift();
    if (next) { inFlight++; next(); }
  }

  async function httpGetBase64(url) {
    const Http = getHttp();
    const ref = refererFor(url);
    const headers = {
      'User-Agent': UA,
      ...(ref ? { Referer: ref, Origin: ref } : {}),
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
    };

    if (isAndroid() && Http?.get) {
      const res = await Http.get({
        url,
        responseType: 'arraybuffer',
        headers,
        readTimeout: 45000,
        connectTimeout: 20000
      });
      const status = res.status ?? 0;
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status} for ${url}`);
      return String(res.data || '');
    }
    const resp = await fetch(url, { headers, credentials: 'omit' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
    const buf = await (await resp.blob()).arrayBuffer();
    return bytesToBase64(new Uint8Array(buf));
  }
  function guessMime(url) {
    let u = String(url || '').toLowerCase();
    try { u = new URL(u, 'https://x/').pathname.toLowerCase(); } catch {}
    if (u.endsWith('.png')) return 'image/png';
    if (u.endsWith('.webp')) return 'image/webp';
    if (u.endsWith('.gif')) return 'image/gif';
    if (u.endsWith('.mp4') || u.endsWith('.m4v')) return 'video/mp4';
    if (u.endsWith('.webm')) return 'video/webm';
    return 'image/jpeg';
  }

  function isVideoMediaUrl(url) {
    const mime = guessMime(url);
    return mime === 'video/mp4' || mime === 'video/webm';
  }

  // Normalize base URL (for stable favourite keys)
  function normalizeBaseUrl(u) {
    try {
      const url = new URL(String(u || '').trim());
      url.hash = '';
      url.search = '';
      return url.toString().replace(/\/+$/, '');
    } catch {
      return String(u || '').replace(/\/+$/, '');
    }
  }

  // Config and local favourites
  const CFG_KEY = 'sb_config_v1';
  const DEFAULT_SITES = [
    { name: 'Danbooru', type: 'danbooru', baseUrl: 'https://danbooru.donmai.us', rating: 'safe', tags: '' },
    { name: 'Gelbooru', type: 'gelbooru', baseUrl: 'https://gelbooru.com', rating: 'safe', tags: '' },
    { name: 'Yande.re', type: 'moebooru', baseUrl: 'https://yande.re', rating: 'safe', tags: '' }
  ];
  function defaultConfig() { return { sites: DEFAULT_SITES }; }
  async function loadConfigWeb() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (!raw) return defaultConfig();
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.sites)) {
        parsed.sites = parsed.sites.map((s) => ({ rating: 'safe', tags: '', ...s }));
        return parsed;
      }
      return defaultConfig();
    } catch { return defaultConfig(); }
  }
  async function saveConfigWeb(cfg) { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg || defaultConfig())); } catch {} return cfg || defaultConfig(); }

  // Local favorites
  const FAV_KEYS = 'sb_local_favs_keys_v1';
  const FAV_POSTS = 'sb_local_favs_posts_v1';
  function favLoadKeys() { try { return new Set(JSON.parse(localStorage.getItem(FAV_KEYS) || '[]')); } catch { return new Set(); } }
  function favSaveKeys(set) { try { localStorage.setItem(FAV_KEYS, JSON.stringify([...set])); } catch {} }
  function favLoadMap() { try { return new Map(Object.entries(JSON.parse(localStorage.getItem(FAV_POSTS) || '{}'))); } catch { return new Map(); } }
  function favSaveMap(map) { try { localStorage.setItem(FAV_POSTS, JSON.stringify(Object.fromEntries(map))); } catch {} }
  async function favKeys() { return [...favLoadKeys()]; }
  async function favList() { const map = favLoadMap(); const out = []; for (const v of map.values()) { try { out.push(JSON.parse(v)); } catch {} } return out; }

  const { fetchBooruWeb, autocompleteWeb } = window.createBooruClient({ httpGetJSON, httpGetText, isVideoMediaUrl });

  // proxy image with LRU cache and server fallback (CapacitorHttp to bypass CORS)
  async function proxyImage(input) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    try {
      if (!url) return { ok: false, error: 'No URL', url: '', dataUrl: '' };

      const cached = cacheGet(url);
      if (cached) return { ok: true, url: cached, dataUrl: cached };

      await acquire();
      try {
        const base64 = await httpGetBase64(url);
        const mime = guessMime(url);
        const dataUrl = `data:${mime};base64,${base64}`;
        cachePut(url, dataUrl);
        return { ok: true, url: dataUrl, dataUrl };
      } finally {
        release();
      }
    } catch (e) {
      // Fallback via server proxy (CORS enabled). On Android use CapacitorHttp to bypass CORS.
      try {
        const acc = accLoad(); const base = accGetBase(acc);
        if (!base) throw e;
        const proxyUrl = `${base}/imgproxy?url=${encodeURIComponent(url)}`;

        const Http = getHttp();
        if (isAndroid() && Http?.get) {
          const res = await Http.get({
            url: proxyUrl,
            responseType: 'arraybuffer',
            headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'User-Agent': UA },
            readTimeout: 30000,
            connectTimeout: 15000
          });
          if ((res.status ?? 0) >= 200 && (res.status ?? 0) < 300) {
            const mime = guessMime(url);
            const dataUrl = `data:${mime};base64,${String(res.data || '')}`;
            cachePut(url, dataUrl);
            return { ok: true, url: dataUrl, dataUrl };
          }
          throw new Error(`proxy HTTP ${res.status}`);
        } else {
          const resp = await fetch(proxyUrl, { headers: { Accept: 'image/*' } });
          if (!resp.ok) throw new Error(`proxy ${resp.status}`);
          const blob = await resp.blob();
          const dataUrl = await new Promise((resolve) => {
            const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.readAsDataURL(blob);
          });
          cachePut(url, dataUrl);
          return { ok: true, url: dataUrl, dataUrl };
        }
      } catch (e2) {
        // Demote to warn to avoid noisy logs on Android when server proxy denies
        console.warn('proxyImage failed', e2);
        return { ok: false, error: String(e2), url: '', dataUrl: '' };
      }
    }
  }

  function mediaproxyUrl(url, { download = false, filename = '' } = {}) {
    const base = webProxyBase();
    if (!base) return '';
    const q = new URLSearchParams({ url });
    q.set('accept', 'image/*,video/*,application/octet-stream,*/*');
    if (download) {
      q.set('download', '1');
      if (filename) q.set('filename', filename);
    }
    return `${base}/mediaproxy?${q.toString()}`;
  }

  async function fetchMediaBlob(url) {
    const needsProxy = isWebBrowser() || isAndroid();
    const proxy = needsProxy ? mediaproxyUrl(url) : '';
    const fetchUrl = proxy || url;
    const Http = getHttp();
    if (isAndroid() && Http?.get) {
      const res = await Http.get({
        url: fetchUrl,
        responseType: 'arraybuffer',
        headers: { Accept: 'image/*,video/*,application/octet-stream,*/*', 'User-Agent': UA },
        readTimeout: 120000,
        connectTimeout: 30000
      });
      const status = res.status ?? 0;
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
      const mime = res.headers?.['content-type'] || res.headers?.['Content-Type'] || guessMime(url);
      let data = res.data;
      if (typeof data === 'string') {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        data = bytes;
      }
      return new Blob([data], { type: mime });
    }
    const r = await fetch(fetchUrl, { headers: { Accept: 'image/*,video/*,application/octet-stream,*/*' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.blob();
  }

  async function triggerBlobDownload(blob, filename) {
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = String(filename || 'download').replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').slice(0, 200);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
  }

  function triggerUrlDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = String(filename || 'download').replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').slice(0, 200);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function downloadMediaAndroid(url, safeName) {
    const Filesystem = C?.Plugins?.Filesystem;
    const FileTransfer = C?.Plugins?.FileTransfer;
    const fetchUrl = mediaproxyUrl(url, { download: true, filename: safeName }) || url;

    if (Filesystem?.mkdir) {
      try { await Filesystem.mkdir({ path: 'StreamBooru', directory: 'EXTERNAL', recursive: true }); } catch {}
    }

    if (FileTransfer?.downloadFile && Filesystem?.getUri) {
      const destination = await Filesystem.getUri({ path: `StreamBooru/${safeName}`, directory: 'EXTERNAL' });
      const result = await FileTransfer.downloadFile({
        url: fetchUrl,
        path: destination.uri,
        headers: { Accept: 'image/*,video/*,application/octet-stream,*/*', 'User-Agent': UA },
        progress: false
      });
      return { ok: true, path: result?.path || destination.uri };
    }

    if (Filesystem?.downloadFile) {
      const result = await Filesystem.downloadFile({
        url: fetchUrl,
        path: `StreamBooru/${safeName}`,
        directory: 'EXTERNAL',
        headers: { Accept: 'image/*,video/*,application/octet-stream,*/*', 'User-Agent': UA }
      });
      return { ok: true, path: result?.path || '' };
    }

    const blob = await fetchMediaBlob(url);
    if (!Filesystem?.writeFile) throw new Error('Filesystem plugin unavailable');
    const buf = await blob.arrayBuffer();
    const result = await Filesystem.writeFile({
      path: `StreamBooru/${safeName}`,
      data: bytesToBase64(new Uint8Array(buf)),
      directory: 'EXTERNAL',
      recursive: true
    });
    return { ok: true, path: result?.uri || '' };
  }

  async function downloadMediaWeb({ url, fileName, siteName }) {
    if (isElectron() && window.api?.downloadImage) {
      return window.api.downloadImage({ url, siteName, fileName });
    }
    const safeName = String(fileName || 'download').replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').slice(0, 200);
    try {
      if (isAndroid()) {
        return await downloadMediaAndroid(url, safeName);
      }
      if (isWebBrowser()) {
        const downloadUrl = mediaproxyUrl(url, { download: true, filename: safeName });
        if (!downloadUrl) throw new Error('Media proxy unavailable');
        triggerUrlDownload(downloadUrl, safeName);
        return { ok: true, path: '(browser downloads)' };
      }
      const blob = await fetchMediaBlob(url);
      await triggerBlobDownload(blob, safeName);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  let bulkWebJob = null;
  function downloadBulkCancelWeb() {
    if (isElectron() && window.api?.downloadBulkCancel) return window.api.downloadBulkCancel();
    if (bulkWebJob) { bulkWebJob.cancelled = true; return { ok: true }; }
    return { ok: false };
  }

  async function downloadBulkWeb(items, options = {}) {
    if (isElectron() && window.api?.downloadBulk) {
      return window.api.downloadBulk(items, options);
    }
    if (!Array.isArray(items) || items.length === 0) {
      return { ok: false, error: 'No items to download' };
    }

    const job = { cancelled: false };
    bulkWebJob = job;
    const total = items.length;
    let done = 0;
    let saved = 0;
    const failed = [];
    const progress = () => {
      try { window.events?.emit?.('download_progress', { done, total, saved, failed: failed.length, cancelled: job.cancelled }); } catch {}
    };
    const finish = (result) => {
      if (bulkWebJob === job) bulkWebJob = null;
      return result;
    };

    if (isWebBrowser() && items.length > 1) {
      const ok = window.confirm(`Download ${items.length} files? Your browser will save them one at a time.`);
      if (!ok) return finish({ ok: false, cancelled: true });
      progress();
      for (let i = 0; i < items.length; i++) {
        if (job.cancelled) break;
        const it = items[i];
        try {
          const safeName = String(it.fileName || `file_${i}`).replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').slice(0, 200);
          const downloadUrl = mediaproxyUrl(it.url, { download: true, filename: safeName });
          if (!downloadUrl) throw new Error('Media proxy unavailable');
          triggerUrlDownload(downloadUrl, safeName);
          saved++;
        } catch (e) {
          failed.push({ i, error: String(e?.message || e) });
        }
        done++;
        progress();
      }
      return finish({ ok: true, saved, failed, basePath: '(browser downloads)', cancelled: job.cancelled, remaining: total - done });
    }

    const concurrency = Number(options.concurrency || 3);
    let index = 0;
    const worker = async () => {
      while (true) {
        if (job.cancelled) return;
        const i = index++;
        if (i >= items.length) return;
        const it = items[i];
        try {
          const result = await downloadMediaWeb({ url: it.url, fileName: it.fileName || `file_${i}`, siteName: it.siteName });
          if (!result?.ok) throw new Error(result?.error || 'Download failed');
          saved++;
        } catch (e) {
          failed.push({ i, error: String(e?.message || e) });
        }
        done++;
        progress();
      }
    };
    progress();
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
    return finish({ ok: true, saved, failed, basePath: '(browser downloads)', cancelled: job.cancelled, remaining: total - done });
  }

  // Account helpers for remote sync
  const ACC_KEY = 'sb_account_v1';
  function accLoad() { try { return JSON.parse(localStorage.getItem(ACC_KEY) || '{}'); } catch { return {}; } }
  function accSave(obj) { try { localStorage.setItem(ACC_KEY, JSON.stringify(obj || {})); } catch {} }
  function accGetBase(acc) {
    let b = String(acc?.serverBase || '').trim();
    if (!b && isWebBrowser()) b = defaultOriginBase();
    if (!b) return '';
    try { const u = new URL(b); return u.toString().replace(/\/+$/,''); } catch { return b.replace(/\/+$/,''); }
  }
  async function getMe(base, token) { try { return await httpGetJSON(`${base}/api/me`, { Authorization: `Bearer ${token}` }); } catch (e) { return { ok: false, error: String(e?.message || e) }; } }

  async function hydrateAccountUser(acc, { clearOnInvalid = true } = {}) {
    const base = accGetBase(acc);
    const token = String(acc?.token || '').trim();
    if (!base || !token) return acc;

    const me = await getMe(base, token);
    if (me?.ok && me.user) {
      acc.user = me.user;
      accSave(acc);
      return acc;
    }

    if (clearOnInvalid && /HTTP 401\b/i.test(String(me?.error || ''))) {
      acc.token = '';
      acc.user = null;
      accSave({ serverBase: acc.serverBase || '', token: '', user: null });
      closeSse();
    }
    return acc;
  }

  async function clearLocalSyncedData() {
    const cfg = await loadConfigWeb();
    const sites = (Array.isArray(cfg.sites) ? cfg.sites : []).map((s) => ({ ...s, credentials: {} }));
    const next = { ...cfg, sites };
    await saveConfigWeb(next);
    window.events?.emit?.('config_changed', next);
    return next;
  }

  // Favourites toggle (remote + local) — use British endpoints
  async function favToggle(post) {
    const key = `${normalizeBaseUrl(post?.site?.baseUrl || '')}#${post?.id}`;
    const keys = favLoadKeys(); const map = favLoadMap();
    let favorited;
    const now = Date.now();
    if (keys.has(key)) { keys.delete(key); map.delete(key); favorited = false; }
    else { keys.add(key); map.set(key, JSON.stringify({ ...post, _added_at: now })); favorited = true; }
    favSaveKeys(keys); favSaveMap(map);

    try {
      const acc = accLoad();
      const base = accGetBase(acc);
      const token = acc?.token || '';
      if (base && token) {
        if (favorited) {
          await httpPutJSON(`${base}/api/favourites/${encodeURIComponent(key)}`, { post, added_at: now }, { Authorization: `Bearer ${token}` });
        } else {
          await httpDelete(`${base}/api/favourites/${encodeURIComponent(key)}`, { Authorization: `Bearer ${token}` });
        }
      }
    } catch (e) {
      console.warn('Remote favourite sync failed:', e?.message || e);
    }

    return { ok: true, favorited, key };
  }

  // Merge remote favourites with local ones; local-only faves get pushed up
  // rather than overwritten. Use British endpoints.
  let lastPushedFavSig = '';
  async function syncReplaceFavorites() {
    const acc = accLoad(); const base = accGetBase(acc);
    if (!base || !acc.token) { lastPushedFavSig = ''; return { ok: false, error: 'Not logged in' }; }
    const data = await httpGetJSON(`${base}/api/favourites`, { Authorization: `Bearer ${acc.token}` });
    const remote = Array.isArray(data?.items) ? data.items : [];
    const deletedAt = new Map();
    for (const d of Array.isArray(data?.deletions) ? data.deletions : []) {
      if (d?.key) deletedAt.set(String(d.key), Number(d.deleted_at) || 0);
    }
    const keys = new Set();
    const map = new Map();
    for (const it of remote) {
      const k = String(it.key || ''); if (!k || !it.post) continue;
      keys.add(k);
      map.set(k, JSON.stringify({ ...it.post, _added_at: Number(it.added_at) || Date.now() }));
    }
    const localKeys = favLoadKeys();
    const localMap = favLoadMap();
    const extras = [];
    for (const k of localKeys) {
      if (keys.has(k)) continue;
      const raw = localMap.get(k);
      if (!raw) continue;
      let post = null;
      try { post = JSON.parse(raw); } catch {}
      const addedAt = Number(post?._added_at) || 0;
      // another device unfaved it after this one saved it, so let the removal win
      if (post && (deletedAt.get(k) ?? -1) >= addedAt) continue;
      keys.add(k);
      map.set(k, raw);
      if (post) extras.push({ key: k, added_at: addedAt || Date.now(), post });
    }
    // The server echoes our own writes back over SSE, so a sync that settled on the same
    // set must not report a change — the feed would rebuild under the user every echo.
    const changed = keys.size !== localKeys.size
      || [...keys].some((k) => !localKeys.has(k) || localMap.get(k) !== map.get(k));
    if (changed) {
      favSaveKeys(keys);
      favSaveMap(map);
    }
    // Anything the server declines to keep is still missing from the next pull, so
    // re-pushing the same set only earns another echo and another sync.
    const pushSig = extras.map((e) => e.key).sort().join('\n');
    if (extras.length && pushSig !== lastPushedFavSig) {
      try {
        await httpPostJSON(`${base}/api/favourites/bulk_upsert`, { items: extras }, { Authorization: `Bearer ${acc.token}` });
        lastPushedFavSig = pushSig;
      } catch (e) {
        console.warn('failed to push local-only favourites', e?.message || e);
      }
    }
    return { ok: true, count: keys.size, pushed: extras.length, changed };
  }

  // Sites sync helpers
  const normBase = normalizeBaseUrl;
  function buildSitesPayload(sites) {
    return (Array.isArray(sites) ? sites : []).map((s, idx) => {
      const base_url = normBase(s.base_url || s.baseUrl || '');
      const credIn = (s && typeof s.credentials === 'object' && !Array.isArray(s.credentials)) ? s.credentials : {};
      const out = {
        name: String(s.name || ''),
        type: String(s.type || '').toLowerCase(),
        base_url,
        rating: String(s.rating || 'safe'),
        tags: String(s.tags || ''),
        queryDialect: String(s.queryDialect || s.query_dialect || 'auto'),
        order_index: Number(s.order_index ?? idx) || idx,
        enabled: s.enabled !== false,
        credentials: {}
      };
      if (out.type === 'danbooru') {
        out.credentials.login = String(credIn.login || '');
        out.credentials.api_key = String(credIn.api_key || '');
      } else if (out.type === 'moebooru') {
        out.credentials.login = String(credIn.login || '');
        out.credentials.password_hash = String(credIn.password_hash || '');
      } else {
        Object.entries(credIn).forEach(([k,v]) => {
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out.credentials[k] = v;
        });
      }
      return out;
    });
  }
  async function pullSitesFromServerAndSave() {
    try {
      const r = await api.sitesGetRemote();
      if (r?.ok && Array.isArray(r.sites)) {
        const cfg = await loadConfigWeb();
        // older servers don't send `enabled`; fall back to the local flag
        const keyOf = (s) => `${(s?.type || '').toLowerCase()}|${normBase(s?.baseUrl || s?.base_url || '')}`;
        const localByKey = new Map((cfg.sites || []).map((s) => [keyOf(s), s]));
        const sites = r.sites.map((s) => {
          if (typeof s?.enabled === 'boolean') return s;
          const local = localByKey.get(keyOf(s));
          return local && local.enabled === false ? { ...s, enabled: false } : s;
        });
        const next = { ...cfg, sites };
        await saveConfigWeb(next);
        window.events?.emit?.('config_changed', next);
        return { ok: true, count: sites.length };
      }
      return { ok: false, error: 'No sites' };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  // SSE with debounce to avoid storms
  let sse = { es: null, base: '', token: '' };
  let sseConnecting = false;
  let favSyncTimer = null;
  let favSyncInFlight = false;
  let favSyncNeedsRerun = false;

  function scheduleFavSync() {
    if (favSyncTimer) return;
    favSyncTimer = setTimeout(async () => {
      favSyncTimer = null;
      if (favSyncInFlight) { favSyncNeedsRerun = true; return; }
      favSyncInFlight = true;
      try {
        const res = await syncReplaceFavorites();
        try { const keys = await favKeys(); window.__localFavsSet = new Set(keys || []); } catch {}
        if (res?.changed) window.events?.emit?.('favorites_changed', { ok: true, source: 'sse' });
      } catch (e) {
        console.warn('SSE favourites sync error', e?.message || e);
      } finally {
        favSyncInFlight = false;
        if (favSyncNeedsRerun) { favSyncNeedsRerun = false; scheduleFavSync(); }
      }
    }, 250);
  }

  async function openSse() {
    try {
      const acc = accLoad(); const base = accGetBase(acc); const token = acc?.token || '';
      if (!base || !token) return closeSse();
      if (sse.es && sse.base === base && sse.token === token) return;
      if (sseConnecting) { setTimeout(() => openSse(), 1000); return; }
      sseConnecting = true;

      // EventSource cannot set an Authorization header, so trade the account token for a
      // short-lived stream ticket rather than leaving it in the URL. Servers older than
      // 1.2.0 have no ticket endpoint.
      let credential = '';
      try {
        const t = await httpPostJSON(`${base}/api/stream/ticket`, {}, { Authorization: `Bearer ${token}` });
        if (t?.ticket) credential = `ticket=${encodeURIComponent(t.ticket)}`;
      } catch {}
      if (!credential) credential = `access_token=${encodeURIComponent(token)}`;

      closeSse();
      const url = `${base}/api/stream?${credential}&t=${Date.now()}`;
      const es = new EventSource(url, { withCredentials: false });
      sse = { es, base, token };

      es.addEventListener('hello', () => {});
      es.addEventListener('ping', () => {});
      es.addEventListener('fav_changed', (ev) => {
        // apply removals directly; a merge-pull would push the fave right back
        try {
          const payload = JSON.parse(ev?.data || '{}');
          if (payload && payload.removed && payload.key) {
            const k = String(payload.key);
            const keys = favLoadKeys();
            if (keys.delete(k)) {
              const map = favLoadMap();
              map.delete(k);
              favSaveKeys(keys);
              favSaveMap(map);
            }
            try { window.__localFavsSet?.delete?.(k); } catch {}
            window.events?.emit?.('favorites_changed', { ok: true, source: 'sse-remove' });
            return;
          }
        } catch {}
        scheduleFavSync();
      });
      es.addEventListener('sites_changed', async () => {
        // Pull fresh sites (including credentials) and update local config
        await pullSitesFromServerAndSave();
      });
      es.onerror = () => { setTimeout(() => { if (sse.es === es) openSse(); }, 3000); };
    } catch {} finally { sseConnecting = false; }
  }
  function closeSse() {
    try { sse.es?.close?.(); } catch {}
    sse = { es: null, base: '', token: '' };
  }

  // Deep link handling (Discord login) — attach ASAP and also on resume
  async function finishOAuthLogin(token) {
    if (!token) return;
    const acc = accLoad();
    acc.token = token;
    if (!acc.serverBase) {
      const o = defaultOriginBase() || (typeof window !== 'undefined' ? window.location.origin.replace(/\/+$/, '') : '');
      if (o) acc.serverBase = o;
    }
    const base = accGetBase(acc);
    try {
      if (base) {
        await hydrateAccountUser(acc, { clearOnInvalid: false });
      }
    } catch {}
    accSave(acc);
    openSse();
    window.events?.emitAccountChanged?.();
    try { await (window.api?.syncOnLogin?.()); } catch {}
  }

  async function finishOAuthLink() {
    const acc = accLoad();
    const base = accGetBase(acc);
    if (!base || !acc.token) return;
    try {
      const me = await getMe(base, acc.token);
      if (me?.ok && me.user) { acc.user = me.user; accSave(acc); }
    } catch {}
    window.events?.emitAccountChanged?.();
  }

  function handleWebOAuthMessage(ev) {
    if (!isWebBrowser()) return;
    try {
      if (ev.origin !== window.location.origin) return;
      const d = ev.data;
      if (!d || d.type !== 'streambooru_oauth') return;
      if (d.token) finishOAuthLogin(d.token);
      else if (d.linked) finishOAuthLink();
    } catch {}
  }

  if (isWebBrowser()) {
    window.addEventListener('message', handleWebOAuthMessage);
  }

  // OAuth nonce ties a deep-link callback to a login this app actually started,
  // blocking drive-by streambooru://oauth/... token injection from other apps.
  const OAUTH_NONCE_KEY = 'sb_oauth_nonce_v1';
  function setOAuthNonce() {
    const nonce = (window.crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2)));
    try { localStorage.setItem(OAUTH_NONCE_KEY, JSON.stringify({ nonce, exp: Date.now() + 15 * 60 * 1000 })); } catch {}
    return nonce;
  }
  function consumeOAuthNonce(candidate) {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(OAUTH_NONCE_KEY) || 'null'); } catch {}
    try { localStorage.removeItem(OAUTH_NONCE_KEY); } catch {}
    if (!stored || !stored.nonce || Date.now() > (stored.exp || 0)) return false;
    return !!candidate && candidate === stored.nonce;
  }

  function handleDeepLink(url) {
    try {
      if (!url || !String(url).startsWith('streambooru://')) return;
      const u = new URL(url);
      if (!consumeOAuthNonce(u.searchParams.get('state') || '')) return;
      const token = u.searchParams.get('token') || '';
      const linked = u.searchParams.get('linked') || '';
      const acc = accLoad();
      if (token) {
        acc.token = token;
        const base = accGetBase(acc);
        if (base) {
          getMe(base, token).then(async (me) => {
            if (me?.ok && me.user) { acc.user = me.user; accSave(acc); }
            else accSave(acc);
            openSse();
            window.events?.emitAccountChanged?.();
            api.syncOnLogin?.();
          }).catch(async ()=>{ accSave(acc); openSse(); window.events?.emitAccountChanged?.(); api.syncOnLogin?.(); });
        } else {
          accSave(acc);
          openSse();
          window.events?.emitAccountChanged?.();
          api.syncOnLogin?.();
        }
      } else if (linked) {
        const base = accGetBase(acc);
        if (base && acc.token) {
          getMe(base, acc.token).then((me) => {
            if (me?.ok && me.user) { acc.user = me.user; accSave(acc); }
            window.events?.emitAccountChanged?.();
          }).catch(()=>{});
        }
      }
    } catch {}
  }
  (function attachDeepLinkListeners() {
    try {
      const App = C?.Plugins?.App;
      if (!App) return;
      if (typeof App.getLaunchUrl === 'function') {
        App.getLaunchUrl().then((res)=>{ const url = res?.url || res; if (url) handleDeepLink(String(url)); }).catch(()=>{});
      }
      if (typeof App.addListener === 'function') {
        App.addListener('appUrlOpen', (data) => { try { handleDeepLink(String(data?.url || '')); } catch {} });
        App.addListener('appStateChange', (st) => {
          try {
            if (st?.isActive && typeof App.getLaunchUrl === 'function') {
              App.getLaunchUrl().then((res)=>{ const url = res?.url || res; if (url) handleDeepLink(String(url)); }).catch(()=>{});
            }
          } catch {}
        });
        // hardware back closes overlays before exiting the app
        App.addListener('backButton', () => {
          try {
            if (window.SBOverlay?.closeTop?.()) return;
          } catch {}
          try { App.exitApp?.(); } catch {}
        });
      }
    } catch {}
  })();

  // expose
  window.Platform = { isElectron, isAndroid, openExternal: async (url) => {
    const safeUrl = safeHttpUrl(url);
    if (!safeUrl) return false;
    if (isElectron() && window.api?.openExternal) return window.api.openExternal(safeUrl);
    if (C?.Plugins?.Browser?.open) { await C.Plugins.Browser.open({ url: safeUrl }); return true; }
    window.open(safeUrl, '_blank', 'noopener,noreferrer'); return true;
  }, fetchMediaBlob, mediaproxyUrl, downloadMediaWeb, downloadBulkWeb, getVersion: async () => {
    if (isElectron() && window.api?.getVersion) return window.api.getVersion();
    if (C?.Plugins?.App?.getInfo) { try { const info = await C.Plugins.App.getInfo(); return info?.version || 'android'; } catch {} }
    return 'web';
  }, ensureStoragePermission: async () => {
    if (!isAndroid() || !C?.Plugins?.Filesystem) return true;
    if (typeof C.Plugins.Filesystem.requestPermissions === 'function') {
      try { const perm = await C.Plugins.Filesystem.requestPermissions(); return perm.publicStorage === 'granted' || perm.publicStorage === 'limited'; }
      catch { return true; }
    }
    return true;
  } };

  (function ensureProxyHelpers() {
    window.api = window.api || {};
    window.api.proxyImage = proxyImage;
    window.api.fetchMediaBlob = fetchMediaBlob;
    window.api.mediaproxyUrl = mediaproxyUrl;
  })();

  if (!isElectron()) {
    const api = {
      loadConfig: loadConfigWeb,
      saveConfig: saveConfigWeb,
      fetchBooru: fetchBooruWeb,
      autocomplete: async ({ site, prefix, limit } = {}) => {
        try {
          const suggestions = await autocompleteWeb({ site, prefix, limit });
          return { ok: true, suggestions };
        } catch (e) {
          return { ok: false, suggestions: [], error: String(e?.message || e) };
        }
      },
      openExternal: window.Platform.openExternal,
      downloadImage: downloadMediaWeb,
      downloadBulk: downloadBulkWeb,
      downloadBulkCancel: downloadBulkCancelWeb,
      proxyImage,
      authCheck: async () => ({ ok: true }),
      rateLimit: async () => ({ ok: true }),
      favCounts: async (keys) => {
        try {
          const base = webProxyBase();
          const list = (Array.isArray(keys) ? keys : []).filter(Boolean).slice(0, 200);
          if (!base || list.length === 0) return { ok: !!base, counts: {} };
          const { status, json } = await httpPostJSON(`${base}/api/favourites/counts`, { keys: list });
          if (status < 400 && json?.ok) return { ok: true, counts: json.counts || {} };
          return { ok: false, counts: {} };
        } catch {
          return { ok: false, counts: {} };
        }
      },
      getLocalFavoriteKeys: favKeys,
      getLocalFavorites: favList,
      toggleLocalFavorite: favToggle,

      // Accounts
      accountGet: async () => {
        let acc = accLoad();
        if (isWebBrowser() && !acc.serverBase) {
          const origin = defaultOriginBase();
          if (origin) { acc.serverBase = origin; accSave(acc); }
        }
        if (acc.token) {
          acc = await hydrateAccountUser(acc);
        }
        setTimeout(openSse, 0);
        return { serverBase: acc.serverBase || '', token: acc.token || '', user: acc.user || null, loggedIn: !!acc.token };
      },
      accountSetServer: async (base) => {
        const acc = accLoad(); acc.serverBase = String(base || '').trim(); accSave(acc);
        openSse();
        return { ok: true, serverBase: acc.serverBase || '' };
      },
      accountRegister: async (username, password) => {
        const acc = accLoad(); const base = accGetBase(acc);
        if (!base) return { ok: false, error: 'No server selected' };

        let { status, json } = await httpPostJSON(`${base}/auth/local/register`, { username, password });
        if (status >= 400 || !json?.token) {
          const auth = 'Basic ' + b64(`${username}:${password}`);
          ({ status, json } = await httpPostJSON(`${base}/auth/local/register`, {}, { Authorization: auth, 'X-Username': username, 'X-Password': password }));
        }
        if (status >= 400 || !json?.token) return { ok: false, error: json?.error || 'Register failed' };

        acc.token = json.token;
        try { const me = await httpGetJSON(`${base}/api/me`, { Authorization: `Bearer ${acc.token}` }); if (me?.ok && me.user) acc.user = me.user; } catch {}
        accSave(acc);
        openSse();
        window.events?.emitAccountChanged?.();
        await api.syncOnLogin();
        return { ok: true, user: acc.user || null };
      },
      accountLoginLocal: async (username, password) => {
        const acc = accLoad(); const base = accGetBase(acc);
        if (!base) return { ok: false, error: 'No server selected' };

        let { status, json } = await httpPostJSON(`${base}/auth/local/login`, { username, password });
        if (status >= 400 || !json?.token) {
          const auth = 'Basic ' + b64(`${username}:${password}`);
          ({ status, json } = await httpPostJSON(`${base}/auth/local/login`, {}, { Authorization: auth, 'X-Username': username, 'X-Password': password }));
        }
        if (status >= 400 || !json?.token) return { ok: false, error: json?.error || 'Login failed' };

        acc.token = json.token;
        try { const me = await httpGetJSON(`${base}/api/me`, { Authorization: `Bearer ${acc.token}` }); if (me?.ok && me.user) acc.user = me.user; } catch {}
        accSave(acc);
        openSse();
        window.events?.emitAccountChanged?.();
        await api.syncOnLogin();
        return { ok: true, user: acc.user || null };
      },
      accountLoginDiscord: async () => {
        if (isWebBrowser()) return accountBeginDiscordLogin();
        const acc = accLoad();
        let base = accGetBase(acc);
        if (!base) return { ok: false, error: 'No server selected' };
        const deepLink = `streambooru://oauth/discord?state=${encodeURIComponent(setOAuthNonce())}`;
        await window.Platform.openExternal(`${base}/auth/discord?redirect_uri=${encodeURIComponent(deepLink)}`);
        return { ok: true, pending: true };
      },
      accountBeginDiscordLogin: () => accountBeginDiscordLogin(),
      accountLinkDiscord: async () => {
        const acc = accLoad(); const base = accGetBase(acc);
        if (!base || !acc.token) return { ok: false, error: 'Not logged in' };
        try {
          const next = isWebBrowser() ? webOAuthRedirect() : `streambooru://oauth/linked?state=${encodeURIComponent(setOAuthNonce())}`;
          const start = await httpGetJSON(`${base}/api/link/discord/start?next=${encodeURIComponent(next)}`, { Authorization: `Bearer ${acc.token}` });
          if (start?.ok && start.url) {
            if (isWebBrowser()) return openWebOAuth(start.url);
            await window.Platform.openExternal(start.url);
            return { ok: true, pending: true };
          }
          return { ok: false, error: 'Server refused link start' };
        } catch (e) { return { ok: false, error: String(e?.message || e) }; }
      },
      accountUnlinkDiscord: async () => {
        try {
          const acc = accLoad(); const base = accGetBase(acc);
          if (!base || !acc.token) return { ok: false, error: 'Not logged in' };
          const r = await httpPostJSON(`${base}/auth/discord/unlink`, {}, { Authorization: `Bearer ${acc.token}` });
          if ((r?.status || 0) < 400) {
            const me = await httpGetJSON(`${base}/api/me`, { Authorization: `Bearer ${acc.token}` });
            if (me?.ok) { acc.user = me.user || null; accSave(acc); }
            window.events?.emitAccountChanged?.();
            return { ok: true };
          }
          return { ok: false, error: r?.json?.error || 'Unlink failed' };
        } catch (e) {
          return { ok: false, error: String(e?.message || e) };
        }
      },
      accountLogout: async () => {
        const acc = accLoad();
        accSave({ serverBase: acc.serverBase || '', token: '', user: null });
        closeSse();
        try { await clearLocalSyncedData(); } catch {}
        try {
          favSaveKeys(new Set());
          favSaveMap(new Map());
          window.events?.emit?.('favorites_changed', { ok: true, source: 'logout' });
        } catch {}
        window.events?.emitAccountChanged?.();
        return { ok: true };
      },

      // Sync helpers
      syncOnLogin: async () => {
        try {
          await pushAllFavorites();
          await syncReplaceFavorites();
        } catch {}
        // Pull sites (including credentials) and save locally
        await pullSitesFromServerAndSave();
        openSse();
        return { ok: true };
      },
      syncPullFavorites: syncReplaceFavorites,

      // Sites (with credentials)
      sitesGetRemote: async () => {
        try {
          const acc = accLoad(); const base = accGetBase(acc);
          if (!base || !acc.token) return { ok: true, sites: [] };
          const j = await httpGetJSON(`${base}/api/sites`, { Authorization: `Bearer ${acc.token}` });
          return { ok: true, sites: Array.isArray(j?.sites) ? j.sites : [] };
        } catch { return { ok: true, sites: [] }; }
      },
      sitesSaveRemote: async (sites) => {
        try {
          const acc = accLoad(); const base = accGetBase(acc);
          if (!base || !acc.token) return { ok: false, error: 'Not logged in' };
          const payload = { sites: buildSitesPayload(sites) };
          const res = await httpPutJSON(`${base}/api/sites`, payload, { Authorization: `Bearer ${acc.token}` });
          return { ok: res.status && res.status < 400 };
        } catch (e) { return { ok: false, error: String(e?.message || e) }; }
      },
      getVersion: window.Platform.getVersion
    };

    // Local favourites bulk push
    async function pushAllFavorites() {
      const acc = accLoad();
      if (!acc.serverBase || !acc.token) return { ok: false };
      const base = accGetBase(acc);
      const posts = await api.getLocalFavorites();
      const items = posts.map(p => ({ key: `${normalizeBaseUrl(p?.site?.baseUrl || '')}#${p?.id}`, added_at: Number(p._added_at)||Date.now(), post: p }));
      const r = await httpPostJSON(`${base}/api/favourites/bulk_upsert`, { items }, { Authorization: `Bearer ${acc.token}` });
      return { ok: r.status && r.status < 400 };
    }

    window.api = Object.assign(window.api || {}, api);

    openSse();

    // If already logged in at load, hydrate account and pull sites/favourites once
    (async () => {
      let acc = accLoad();
      if (isWebBrowser() && !acc.serverBase) {
        const origin = defaultOriginBase();
        if (origin) { acc.serverBase = origin; accSave(acc); }
      }
      if (acc?.token && accGetBase(acc)) {
        acc = await hydrateAccountUser(acc);
        if (acc.token) {
          window.events?.emitAccountChanged?.();
          try { await syncReplaceFavorites(); window.events?.emit?.('favorites_changed', { source: 'startup' }); } catch {}
          try { await pullSitesFromServerAndSave(); } catch {}
        }
      }
      if (isWebBrowser()) {
        try {
          const params = new URLSearchParams(window.location.search);
          if (params.get('linked') === '1') {
            acc = await hydrateAccountUser(accLoad());
            window.events?.emitAccountChanged?.();
            history.replaceState({}, '', window.location.pathname);
          }
        } catch {}
      }
    })();
  }

  document.addEventListener('visibilitychange', () => {
    try {
      const App = C?.Plugins?.App;
      if (document.visibilityState === 'visible' && App?.getLaunchUrl) {
        App.getLaunchUrl().then((res)=>{ const url = res?.url || res; if (url) handleDeepLink(String(url)); }).catch(()=>{});
      }
    } catch {}
  });
})();
