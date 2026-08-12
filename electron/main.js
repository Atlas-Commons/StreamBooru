const { app, BrowserWindow, ipcMain, net, Menu, shell, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { createNetworkClient } = require('./network');

/* dev */
const isDev = process.env.SB_DEV === '1';
const isSmokeTest = process.env.SB_SMOKE_TEST === '1';
if (isSmokeTest && process.env.SB_SMOKE_USER_DATA) app.setPath('userData', process.env.SB_SMOKE_USER_DATA);

// XDG compliance on Linux: keep only durable config in ~/.config and push all
// Electron/Chromium data (caches, cookies, web storage, crash dumps) to ~/.cache
// by making userData the cache dir. CONFIG_DIR holds our JSON on every platform.
let CONFIG_DIR;
if (process.platform === 'linux' && !isSmokeTest) {
  const xdgDir = (envVar, fallback) => path.join(process.env[envVar] || path.join(os.homedir(), fallback), app.getName());
  CONFIG_DIR = xdgDir('XDG_CONFIG_HOME', '.config');
  try { app.setPath('userData', xdgDir('XDG_CACHE_HOME', '.cache')); } catch {}
  try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); } catch {}
  // Prune cache/crash dirs older builds wrote into the config dir.
  try {
    for (const dir of ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'ShaderCache', 'GrShaderCache', 'Crashpad', 'blob_storage', 'Local Storage', 'Cookies', 'Cookies-journal', 'Network', 'Shared Dictionary']) {
      fs.promises.rm(path.join(CONFIG_DIR, dir), { recursive: true, force: true }).catch(() => {});
    }
  } catch {}
} else {
  CONFIG_DIR = app.getPath('userData');
}

/* constants */
const DEFAULT_SERVER = 'https://streambooru.ecchibooru.uk';

/* adapters loader */
function loadAdapter(name) {
  const dev = path.join(__dirname, '..', 'src', 'adapters', name);
  const prod = path.join(__dirname, 'src', 'adapters', name);
  try { return require(dev); } catch (e1) {
    try { return require(prod); } catch (e2) {
      const err = new Error(`Cannot load adapter "${name}". Tried:\n - ${dev}\n - ${prod}\n${e1?.stack || e1}\n${e2?.stack || e2}`);
      err.cause = e2; throw err;
    }
  }
}

/* adapters */
const Danbooru    = loadAdapter('danbooru');
const Moebooru    = loadAdapter('moebooru');
const Gelbooru    = loadAdapter('gelbooru');
const E621        = loadAdapter('e621');
const Derpibooru  = loadAdapter('derpibooru');
const { refererHeadersFor, BOORU_UA } = require('../src/shared/refererFor');
const {
  applyDefaultHeaders,
  downloadUrlToFile,
  httpDelete,
  httpGetJson,
  httpPostForm,
  httpPostJson,
  httpPutJson
} = createNetworkClient({ net, refererHeadersFor, userAgent: BOORU_UA, isDev });

let win;

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

async function openSafeExternal(value) {
  const url = safeExternalUrl(value);
  if (!url) return false;
  await shell.openExternal(url);
  return true;
}

/* headers */
function setupHotlinkHeaders(sess) {
  sess.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, cb) => {
    try {
      const headers = { ...details.requestHeaders };
      Object.assign(headers, refererHeadersFor(details.url));
      headers['User-Agent'] = headers['User-Agent'] || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36 StreamBooru/Electron';
      cb({ requestHeaders: headers });
    } catch { cb({}); }
  });

  if (isDev) {
    const filt = { urls: ['*://*/*'] };
    sess.webRequest.onCompleted(filt, (d) => {
      try {
        const h = new URL(d.url).hostname;
        if (h.includes('gelbooru') || h.includes('safebooru') || h.includes('rule34') || h.includes('realbooru') || h.includes('xbooru') || h.includes('derpibooru') || h.includes('derpicdn')) {
          console.log('[net:onCompleted]', JSON.stringify({ origin: new URL(d.url).origin, path: new URL(d.url).pathname, statusCode: d.statusCode, method: d.method, fromCache: d.fromCache || false }));
        }
      } catch {}
    });
    sess.webRequest.onErrorOccurred(filt, (d) => {
      try {
        const h = new URL(d.url).hostname;
        if (h.includes('gelbooru') || h.includes('safebooru') || h.includes('rule34') || h.includes('realbooru') || h.includes('xbooru') || h.includes('derpibooru') || h.includes('derpicdn')) {
          console.warn('[net:onError]', JSON.stringify({ origin: new URL(d.url).origin, path: new URL(d.url).pathname, error: d.error, method: d.method }));
        }
      } catch {}
    });
  }
}

/* window state persistence */
const WINDOW_STATE_PATH = () => path.join(CONFIG_DIR, 'window-state.json');
function readWindowState() {
  try { return JSON.parse(fs.readFileSync(WINDOW_STATE_PATH(), 'utf-8')); } catch { return null; }
}
function sanitizeWindowState(state) {
  const fallback = { width: 1200, height: 800, x: undefined, y: undefined, maximized: false };
  if (!state || !Number.isFinite(state.width) || !Number.isFinite(state.height)) return fallback;
  const width = Math.max(640, Math.round(state.width));
  const height = Math.max(480, Math.round(state.height));
  let { x, y } = state;
  if (Number.isFinite(x) && Number.isFinite(y)) {
    // drop the saved position if its display is gone
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return x < a.x + a.width - 40 && x + width > a.x + 40 && y >= a.y - 8 && y < a.y + a.height - 40;
    });
    if (!visible) { x = undefined; y = undefined; }
  } else {
    x = undefined; y = undefined;
  }
  return { width, height, x, y, maximized: !!state.maximized };
}
function attachWindowStatePersistence(window) {
  let timer = null;
  const persist = () => {
    try {
      const state = { ...window.getNormalBounds(), maximized: window.isMaximized() };
      fs.writeFileSync(WINDOW_STATE_PATH(), JSON.stringify(state), 'utf-8');
    } catch {}
  };
  const debounced = () => { clearTimeout(timer); timer = setTimeout(persist, 400); };
  window.on('resize', debounced);
  window.on('move', debounced);
  window.on('close', () => { clearTimeout(timer); persist(); });
}

/* window */
function createWindow() {
  const state = sanitizeWindowState(readWindowState());
  win = new BrowserWindow({
    width: state.width, height: state.height, x: state.x, y: state.y,
    title: 'StreamBooru', autoHideMenuBar: true, show: !isSmokeTest,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  if (state.maximized && !isSmokeTest) win.maximize();
  attachWindowStatePersistence(win);
  Menu.setApplicationMenu(null);
  win.setMenuBarVisibility(false);
  setupHotlinkHeaders(win.webContents.session);

  // Keep the privileged preload bridge off any remote origin: open external
  // links in the OS browser and refuse in-app navigation away from the bundle.
  const isInternalUrl = (target) => { try { return new URL(target).protocol === 'file:'; } catch { return false; } };
  win.webContents.setWindowOpenHandler(({ url }) => { openSafeExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isInternalUrl(url)) { event.preventDefault(); openSafeExternal(url); }
  });
  win.webContents.on('will-redirect', (event, url) => { if (!isInternalUrl(url)) event.preventDefault(); });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (isSmokeTest) {
    const timeout = setTimeout(() => {
      console.error('STREAMBOORU_SMOKE_TIMEOUT');
      app.exit(1);
    }, 20_000);
    win.webContents.once('did-finish-load', () => {
      clearTimeout(timeout);
      console.log('STREAMBOORU_SMOKE_READY');
      setTimeout(() => app.exit(0), 100);
    });
    win.webContents.once('did-fail-load', (_event, code, description) => {
      clearTimeout(timeout);
      console.error(`STREAMBOORU_SMOKE_FAILED ${code} ${description}`);
      app.exit(1);
    });
  }

  if (isDev) {
    try { win.webContents.openDevTools({ mode: 'detach' }); } catch {}
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  createWindow();

  try {
    const acc = readAccount();
    if (acc?.token) {
      openEventStream();
      if (isDev) console.log('[SSE] startup: pulling favourites once…');
      await pullFavoritesMerge().catch(()=>{});
    }
  } catch {}

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/* paths */
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const FAVORITES_PATH = path.join(CONFIG_DIR, 'favorites.json');
const ACCOUNT_PATH = path.join(CONFIG_DIR, 'account.json');

/* config */
function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = {
      sites: [
        { name: 'Danbooru (safe)', type: 'danbooru', baseUrl: 'https://danbooru.donmai.us', rating: 'safe', tags: '', credentials: { login: '', api_key: '' } },
        { name: 'Yande.re (safe)', type: 'moebooru', baseUrl: 'https://yande.re', rating: 'safe', tags: '', credentials: { login: '', password_hash: '' } },
        { name: 'e621 (safe)', type: 'e621', baseUrl: 'https://e621.net', rating: 'safe', tags: '', credentials: {} },
        { name: 'Derpibooru (safe)', type: 'derpibooru', baseUrl: 'https://derpibooru.org', rating: 'safe', tags: '', credentials: {} }
      ]
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return defaultConfig;
  }
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch { return { sites: [] }; }
}
function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
  try { win?.webContents?.send?.('config:changed', cfg); } catch {}
}
/* Swap in remotely-synced sites without clobbering settings/nameTemplate.
   Older servers don't send `enabled`; fall back to the local flag then. */
function configWithSyncedSites(remoteSites) {
  const cfg = readConfig();
  const keyOf = (s) => `${(s?.type || '').toLowerCase()}|${normalizeBaseUrl(s?.baseUrl || s?.base_url || '')}`;
  const localByKey = new Map((cfg.sites || []).map((s) => [keyOf(s), s]));
  const sites = (Array.isArray(remoteSites) ? remoteSites : []).map((s) => {
    if (typeof s?.enabled === 'boolean') return s;
    const local = localByKey.get(keyOf(s));
    return local && local.enabled === false ? { ...s, enabled: false } : s;
  });
  return { ...cfg, sites };
}

/* favorites */
function favKey(post) { return `${normalizeBaseUrl(post?.site?.baseUrl || '')}#${post?.id}`; }
function loadFavorites() {
  if (!fs.existsSync(FAVORITES_PATH)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(FAVORITES_PATH, 'utf-8'));
    if (!Array.isArray(arr)) return [];
    // Older builds keyed off the raw baseUrl, so re-key through favKey to stay in step with
    // the renderer and collapse the duplicates a trailing slash or host casing produced.
    const byKey = new Map();
    for (const it of arr) {
      if (!it) continue;
      const key = it.post ? favKey(it.post) : String(it.key || '');
      if (!key) continue;
      const prev = byKey.get(key);
      if (!prev || (Number(it.added_at) || 0) < (Number(prev.added_at) || 0)) byKey.set(key, { ...it, key });
    }
    return [...byKey.values()];
  } catch { return []; }
}
function saveFavorites(arr) {
  const next = JSON.stringify(arr, null, 2);
  let prev = null;
  try { prev = fs.readFileSync(FAVORITES_PATH, 'utf-8'); } catch {}
  // The server echoes our own writes back over SSE, and every echo pulls and saves
  // again. Announcing a save that changed nothing rebuilds the feed under the user.
  if (prev === next) return;
  fs.writeFileSync(FAVORITES_PATH, next, 'utf-8');
  try { win?.webContents?.send?.('favorites:changed'); } catch {}
}
function removeLocalFavoriteKey(key) {
  const items = loadFavorites().filter((it) => it.key !== key);
  saveFavorites(items);
}

/* adapters registry */
const adapters = {
  danbooru: new Danbooru(httpGetJson, httpPostForm, httpDelete),
  moebooru: new Moebooru(httpGetJson, httpPostForm),
  gelbooru: new Gelbooru(httpGetJson, (u,h)=>new Promise((resolve,reject)=>{const r=net.request({url:u,method:'GET'});applyDefaultHeaders(r,u,h||{});let d='';r.on('response',(res)=>{res.on('data',(c)=>d+=c);res.on('end',()=>resolve(d))});r.on('error',reject);r.end();})),
  e621: new E621(httpGetJson, httpPostForm, httpDelete),
  derpibooru: new Derpibooru(httpGetJson)
};

/* account store */
function readAccount() {
  if (!fs.existsSync(ACCOUNT_PATH)) {
    const def = { serverBase: DEFAULT_SERVER, token: '', user: null };
    fs.writeFileSync(ACCOUNT_PATH, JSON.stringify(def, null, 2), 'utf-8');
    return def;
  }
  try { return JSON.parse(fs.readFileSync(ACCOUNT_PATH, 'utf-8')); } catch { return { serverBase: DEFAULT_SERVER, token: '', user: null }; }
}
function writeAccount(acc) {
  const base = acc?.serverBase || DEFAULT_SERVER;
  fs.writeFileSync(ACCOUNT_PATH, JSON.stringify({ serverBase: base, token: acc?.token || '', user: acc?.user || null }, null, 2), 'utf-8');
  lastPushedFavSig = '';
  try { win?.webContents?.send?.('account:changed'); } catch {}
}

/* SSE (optional sync) */
let esReq = null;
function closeEventStream() { try { esReq?.abort?.(); } catch {} esReq = null; }

function scheduleReconnect(oldReq) {
  setTimeout(() => {
    if (esReq === oldReq) {
      if (isDev) console.log('[SSE] reconnecting…');
      openEventStream();
    }
  }, 3000);
}

async function openEventStream() {
  closeEventStream();
  const acc = readAccount();
  if (!acc.serverBase || !acc.token) return;
  const url = `${acc.serverBase.replace(/\/+$/,'')}/api/stream`;
  if (isDev) console.log('[SSE] connecting', url);
  const req = net.request({ url, method: 'GET' });
  esReq = req;
  applyDefaultHeaders(req, url, { Accept: 'text/event-stream', Authorization: `Bearer ${acc.token}` });
  let buf = '';
  req.on('response', (res) => {
    if (isDev) console.log('[SSE] connected (status', res.statusCode, ')');
    res.on('end', () => { if (isDev) console.log('[SSE] ended'); scheduleReconnect(req); });
    res.on('aborted', () => { if (isDev) console.log('[SSE] aborted'); scheduleReconnect(req); });
    res.on('data', async (chunk) => {
      buf += chunk.toString('utf8');
      const parts = buf.split(/\n\n/);
      buf = parts.pop() || '';
      for (const part of parts) {
        const lines = part.split('\n');
        let ev = '', data = '';
        for (const ln of lines) {
          if (ln.startsWith('event:')) ev = ln.slice(6).trim();
          else if (ln.startsWith('data:')) data += ln.slice(5).trim();
        }
        if (ev === 'ping' || ev === 'hello') continue;
        if (isDev) console.log('[SSE] event', ev);
        if (ev === 'fav_changed') {
          try {
            let payload = null;
            try { payload = JSON.parse(data || '{}'); } catch {}
            if (payload && payload.removed && payload.key) {
              removeLocalFavoriteKey(String(payload.key));
            } else {
              await pullFavoritesMerge().catch(()=>{});
            }
          } catch {}
        }
        if (ev === 'sites_changed') {
          try { const remote = await sitesRemoteGet(); writeConfig(configWithSyncedSites(remote)); } catch {}
        }
      }
    });
  });
  req.on('error', (e) => { console.warn('[SSE] error', String(e)); scheduleReconnect(req); });
  req.end();
}

/* remote favorites/sites helpers */
async function pushFavoriteRemote(key, post, added_at) {
  const acc = readAccount();
  if (!acc.serverBase || !acc.token) return { ok: false, skipped: true };
  const url = `${acc.serverBase.replace(/\/+$/,'')}/api/favourites/${encodeURIComponent(key)}`;
  const res = await httpPutJson(url, { post, added_at: added_at || Date.now() }, { Authorization: `Bearer ${acc.token}` });
  return { ok: res.status && res.status < 400 };
}
async function deleteFavoriteRemote(key) {
  const acc = readAccount();
  if (!acc.serverBase || !acc.token) return { ok: false, skipped: true };
  const url = `${acc.serverBase.replace(/\/+$/,'')}/api/favourites/${encodeURIComponent(key)}`;
  const res = await httpDelete(url, { Authorization: `Bearer ${acc.token}` });
  return { ok: res.status && res.status < 400 };
}
let lastPushedFavSig = '';
async function pullFavoritesMerge() {
  const acc = readAccount();
  if (!acc.serverBase || !acc.token) return { ok: false, error: 'Not logged in' };
  const url = `${acc.serverBase.replace(/\/+$/,'')}/api/favourites`;
  const j = await httpGetJson(url, { Authorization: `Bearer ${acc.token}` });
  const remote = Array.isArray(j?.items) ? j.items : [];
  const deletedAt = new Map();
  for (const d of Array.isArray(j?.deletions) ? j.deletions : []) {
    if (d?.key) deletedAt.set(String(d.key), Number(d.deleted_at) || 0);
  }

  const merged = new Map();
  for (const it of remote) {
    if (!it || !it.key || !it.post) continue;
    // re-key rows an older build wrote with a raw baseUrl so they line up with local keys
    const key = it.post?.site?.baseUrl ? favKey(it.post) : String(it.key);
    merged.set(key, { key, added_at: Number(it.added_at) || Date.now(), post: it.post });
  }
  // keep faves saved while offline/logged out and push them back up, unless another device
  // unfaved them after this one saved them
  const localOnly = loadFavorites().filter((it) => it?.key && it?.post && !merged.has(it.key)
    && (deletedAt.get(it.key) ?? -1) < (Number(it.added_at) || 0));
  for (const it of localOnly) merged.set(it.key, it);
  const next = [...merged.values()];
  saveFavorites(next);
  // Anything the server declines to keep — a tombstoned key, say — is still missing from
  // the next pull, so re-pushing the same set only earns another echo and another pull.
  const pushSig = localOnly.map((it) => it.key).sort().join('\n');
  if (localOnly.length && pushSig !== lastPushedFavSig) {
    try {
      const pushUrl = `${acc.serverBase.replace(/\/+$/,'')}/api/favourites/bulk_upsert`;
      await httpPostJson(pushUrl, { items: localOnly }, { Authorization: `Bearer ${acc.token}` });
      lastPushedFavSig = pushSig;
    } catch (e) {
      console.warn('[sync] failed to push local-only favourites', String(e?.message || e));
    }
  }
  return { ok: true, count: next.length, pushed: localOnly.length };
}

function normalizeBaseUrl(u) {
  try { const url = new URL(String(u || '').trim()); url.hash = ''; url.search = ''; return url.toString().replace(/\/+$/, ''); }
  catch { return String(u || '').replace(/\/+$/, ''); }
}

async function sitesRemoteGet() {
  const acc = readAccount();
  if (!acc.serverBase || !acc.token) return [];
  const url = `${acc.serverBase.replace(/\/+$/,'')}/api/sites`;
  const j = await httpGetJson(url, { Authorization: `Bearer ${acc.token}` });
  return Array.isArray(j?.sites) ? j.sites : [];
}
async function sitesRemotePut(sites) {
  const acc = readAccount();
  if (!acc.serverBase || !acc.token) return { ok: false };

  // Normalize payload to server's expected shape and include credentials
  const payloadSites = (Array.isArray(sites) ? sites : []).map((s, idx) => {
    const base_url = normalizeBaseUrl(s.base_url || s.baseUrl || '');
    const cred = (s && typeof s.credentials === 'object' && !Array.isArray(s.credentials)) ? s.credentials : {};
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
    // Preserve known credential keys per site type
    if (out.type === 'danbooru') {
      out.credentials.login = String(cred.login || '');
      out.credentials.api_key = String(cred.api_key || '');
    } else if (out.type === 'moebooru') {
      out.credentials.login = String(cred.login || '');
      out.credentials.password_hash = String(cred.password_hash || '');
    } else {
      // passthrough for other site types
      Object.entries(cred).forEach(([k,v]) => { if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out.credentials[k] = v; });
    }
    return out;
  });

  const url = `${acc.serverBase.replace(/\/+$/,'')}/api/sites`;
  const res = await httpPutJson(url, { sites: payloadSites }, { Authorization: `Bearer ${acc.token}` });
  return { ok: res.status && res.status < 400 };
}
async function onLoginUnion() {
  await pushAllFavorites().catch(()=>{});
  await pullFavoritesMerge().catch(()=>{});
  const localCfg = readConfig();
  const localSites = Array.isArray(localCfg?.sites) ? localCfg.sites : [];
  const remoteSites = await sitesRemoteGet();
  const key = (s) => `${(s.type||'').toLowerCase()}|${(s.baseUrl||s.base_url||'').replace(/\/+$/,'')}`;
  const map = new Map();
  for (const s of remoteSites) map.set(key(s), s);
  for (const s of localSites) if (!map.has(key(s))) map.set(key(s), s);
  const union = Array.from(map.values()).map((s, idx)=>({ ...s, order_index: idx }));
  writeConfig(configWithSyncedSites(union));
  await sitesRemotePut(union).catch(()=>{});
  openEventStream();
}
async function pushAllFavorites() {
  const acc = readAccount();
  if (!acc.serverBase || !acc.token) return { ok: false };
  const items = loadFavorites();
  const url = `${acc.serverBase.replace(/\/+$/,'')}/api/favourites/bulk_upsert`;
  const res = await httpPostJson(url, { items }, { Authorization: `Bearer ${acc.token}` });
  return { ok: res.status && res.status < 400 };
}

/* IPC: config */
ipcMain.handle('config:load', async () => readConfig());
ipcMain.handle('config:save', async (_evt, cfg) => { writeConfig(cfg); return { ok: true }; });

/* IPC: fetch */
ipcMain.handle('booru:fetch', async (_evt, payload) => {
  const { site, viewType, cursor, limit = 40, search = '' } = payload || {};
  if (isDev) console.log('[IPC] booru:fetch', site?.type, site?.baseUrl, viewType, search);
  try {
    if (!site || !site.type || !adapters[site.type]) throw new Error(`Unsupported site type: ${site?.type}`);
    const adapter = adapters[site.type];
    const res = (viewType === 'new')
      ? await adapter.fetchNew(site, { cursor, limit, search })
      : (viewType === 'popular')
        ? await adapter.fetchPopular(site, { cursor, limit, search })
        : (() => { throw new Error(`Unsupported viewType: ${viewType}`); })();
    return res;
  } catch (err) {
    if (isDev) console.error('[booru:fetch]', err);
    return { posts: [], nextCursor: cursor || null, error: String(err?.message || err) };
  }
});

/* IPC: tag autocomplete */
ipcMain.handle('booru:autocomplete', async (_evt, payload) => {
  const { site, prefix = '', limit = 10 } = payload || {};
  try {
    if (!site || !site.type || !adapters[site.type]) return { ok: false, suggestions: [] };
    const adapter = adapters[site.type];
    if (typeof adapter.autocomplete !== 'function') return { ok: true, suggestions: [] };
    const suggestions = await adapter.autocomplete(site, prefix, { limit });
    return { ok: true, suggestions: Array.isArray(suggestions) ? suggestions : [] };
  } catch (e) {
    return { ok: false, suggestions: [], error: String(e?.message || e) };
  }
});

/* IPC: external */
ipcMain.handle('openExternal', async (_evt, url) => openSafeExternal(url));

/* IPC: images */
// Collapse control chars, path separators, and bare dot segments so a crafted
// siteName/fileName can't escape the chosen folder via `..`.
function sanitizePathSegment(s) {
  const v = String(s || '').replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').replace(/^\.+$/, '_').slice(0, 200);
  return v || '_';
}
ipcMain.handle('download:image', async (_evt, payload) => {
  const { url, siteName = 'unknown', fileName = '' } = payload || {};
  if (!url) return { ok: false, error: 'No URL' };
  const defaultDir = app.getPath('downloads');
  const name = sanitizePathSegment(fileName || path.basename(new URL(url).pathname));
  const suggested = path.join(defaultDir, 'StreamBooru', sanitizePathSegment(siteName), name);
  const result = await dialog.showSaveDialog(win, { title: 'Save Image', defaultPath: suggested });
  if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
  try {
    await downloadUrlToFile(url, result.filePath);
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
});
let bulkJob = null;
ipcMain.handle('download:bulk', async (_evt, payload) => {
  const { items = [], options = {} } = payload || {};
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: 'No items to download' };
  const picked = await dialog.showOpenDialog(win, { title: 'Choose folder to save images', properties: ['openDirectory', 'createDirectory'] });
  if (picked.canceled || !picked.filePaths?.[0]) return { ok: false, cancelled: true };
  const basePath = picked.filePaths[0];
  await fs.promises.mkdir(basePath, { recursive: true });
  const sanitize = sanitizePathSegment;
  const subfolder = !!options.subfolderBySite;
  const concurrency = Number(options.concurrency || 3);

  const job = { cancelled: false };
  bulkJob = job;
  const total = items.length;
  let done = 0;
  const sendProgress = () => {
    try {
      const saved = results.filter((r) => r.ok).length;
      win?.webContents?.send?.('download:progress', {
        done, total, saved, failed: results.length - saved, cancelled: job.cancelled
      });
    } catch {}
  };

  let index = 0; const results = [];
  const worker = async () => {
    while (true) {
      if (job.cancelled) return;
      const i = index++; if (i >= items.length) return;
      const it = items[i]; try {
        const u = new URL(it.url);
        const siteFolder = subfolder ? sanitize(it.siteName || u.hostname || 'unknown') : '';
        const targetDir = siteFolder ? path.join(basePath, siteFolder) : basePath;
        const filename = sanitize(it.fileName || path.basename(u.pathname) || `file_${i}`);
        const outPath = path.join(targetDir, filename);
        await downloadUrlToFile(it.url, outPath);
        results.push({ i, ok: true, path: outPath });
      } catch (e) { results.push({ i, ok: false, error: String(e?.message || e) }); }
      done++;
      sendProgress();
    }
  };
  sendProgress();
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  if (bulkJob === job) bulkJob = null;
  const saved = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  return { ok: true, saved, failed, basePath, cancelled: job.cancelled, remaining: total - done };
});
ipcMain.handle('download:bulkCancel', async () => {
  if (bulkJob) { bulkJob.cancelled = true; return { ok: true }; }
  return { ok: false };
});

/* IPC: image proxy */
// Block loopback/private/link-local targets so a proxy fetch can't reach the
// local machine or intranet (SSRF); public booru hosts are unaffected.
function isBlockedProxyTarget(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return true; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '::1' || host === '::') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return true;
  }
  if (/^(fe80:|fc|fd)/.test(host)) return true; // IPv6 link-local / unique-local
  return false;
}
ipcMain.handle('image:proxy', async (_evt, { url }) => {
  if (!url) return { ok: false, error: 'No URL' };
  if (isBlockedProxyTarget(url)) return { ok: false, error: 'blocked target' };
  return await new Promise((resolve) => {
    try {
      const req = net.request({ url, method: 'GET' });
      applyDefaultHeaders(req, url, {});
      const chunks = []; let contentType = 'image/jpeg';
      req.on('response', (res) => {
        const status = res.statusCode || 0;
        const ct = res.headers['content-type'] || res.headers['Content-Type'];
        if (ct) contentType = Array.isArray(ct) ? ct[0] : ct;
        if (status >= 400) {
          resolve({ ok: false, error: `HTTP ${status}` });
          return;
        }
        if (String(contentType).toLowerCase().startsWith('video/')) {
          resolve({ ok: false, error: 'not_an_image' });
          return;
        }
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => { const buf = Buffer.concat(chunks); resolve({ ok: true, dataUrl: `data:${contentType};base64,${buf.toString('base64')}` }); });
        res.on('error', (e) => resolve({ ok: false, error: String(e) }));
      });
      req.on('error', (e) => resolve({ ok: false, error: String(e) })); req.end();
    } catch (e) { resolve({ ok: false, error: String(e) }); }
  });
});

/* IPC: site helpers */
ipcMain.handle('booru:favorite', async (_evt, payload) => {
  const { site, postId, action } = payload || {};
  if (!site || !site.type || !adapters[site.type]) return { ok: false, error: 'Unsupported site' };
  try {
    const adapter = adapters[site.type];
    if (typeof adapter.favorite !== 'function') return { ok: false, error: 'Favorites not supported for this site' };
    const result = await adapter.favorite(site, postId, action);
    return { ok: true, result };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
});
ipcMain.handle('booru:authCheck', async (_evt, payload) => {
  const { site } = payload || {};
  if (!site || !site.type || !adapters[site.type]) return { supported: false, ok: false, reason: 'Unsupported site' };
  const adapter = adapters[site.type];
  if (typeof adapter.authCheck !== 'function') return { supported: false, ok: false, reason: 'Not implemented' };
  try { const res = await adapter.authCheck(site); return { supported: true, ok: !!res?.ok, info: res?.info || null }; }
  catch (e) { return { supported: true, ok: false, reason: String(e?.message || e) }; }
});
ipcMain.handle('booru:rateLimit', async (_evt, payload) => {
  const { site } = payload || {};
  if (!site || site.type !== 'danbooru') return { ok: false, reason: 'Rate limit only for Danbooru' };
  const base = (site.baseUrl || '').replace(/\/+$/, '');
  const params = new URLSearchParams(); params.set('limit', '1');
  if (site.credentials?.login && site.credentials?.api_key) { params.set('login', site.credentials.login); params.set('api_key', site.credentials.api_key); }
  const url = `${base}/posts.json?${params.toString()}`;
  return await new Promise((resolve) => {
    try {
      const req = net.request({ url, method: 'GET' });
      applyDefaultHeaders(req, url, { Accept: 'application/json' });
      req.on('response', (res) => {
        const headers = {}; Object.entries(res.headers || {}).forEach(([k, v]) => { headers[String(k).toLowerCase()] = Array.isArray(v) ? v[0] : String(v); });
        const getH = (n) => headers[n] || headers[n.replace('ratelimit', 'rate-limit')] || null;
        const limit = Number(getH('x-ratelimit-limit')) || Number(getH('x-rate-limit-limit')) || null;
        const remaining = Number(getH('x-ratelimit-remaining')) || Number(getH('x-rate-limit-remaining')) || null;
        const reset = Number(getH('x-ratelimit-reset')) || Number(getH('x-rate-limit-reset')) || null;
        res.on('data', () => {}); res.on('end', () => resolve({ ok: true, headers, limit, remaining, reset, status: res.statusCode || 0 }));
      });
      req.on('error', (e) => resolve({ ok: false, reason: String(e) })); req.end();
    } catch (e) { resolve({ ok: false, reason: String(e) }); }
  });
});

/* IPC: local favorites */
ipcMain.handle('favorites:keys', async () => loadFavorites().map((x) => x.key));
ipcMain.handle('favorites:list', async () => loadFavorites().slice().sort((a,b)=>(b.added_at||0)-(a.added_at||0)).map((x)=>({ ...x.post, _added_at: x.added_at||0 })));
ipcMain.handle('favorites:toggle', async (_evt, { post }) => {
  if (!post || !post.id) return { ok: false, error: 'No post' };
  const key = favKey(post);
  const now = Date.now();
  const items = loadFavorites();
  const idx = items.findIndex((it) => it.key === key);
  if (idx >= 0) {
    items.splice(idx, 1); saveFavorites(items);
    setImmediate(() => deleteFavoriteRemote(key));
    return { ok: true, favorited: false, key };
  }
  items.push({ key, added_at: now, post });
  saveFavorites(items);
  setImmediate(() => pushFavoriteRemote(key, post, now));
  return { ok: true, favorited: true, key, added_at: now };
});
ipcMain.handle('favorites:counts', async (_evt, payload) => {
  try {
    const keys = (Array.isArray(payload?.keys) ? payload.keys : [])
      .filter((k) => typeof k === 'string' && k)
      .slice(0, 200);
    if (keys.length === 0) return { ok: true, counts: {} };
    const acc = readAccount();
    const base = (acc.serverBase || DEFAULT_SERVER).replace(/\/+$/, '');
    if (!base) return { ok: false, counts: {} };
    const { status, json } = await httpPostJson(`${base}/api/favourites/counts`, { keys });
    if (status < 400 && json?.ok) return { ok: true, counts: json.counts || {} };
    return { ok: false, counts: {} };
  } catch (e) {
    return { ok: false, counts: {}, error: String(e?.message || e) };
  }
});

/* IPC: account + sync */
ipcMain.handle('account:get', async () => {
  const acc = readAccount();
  if (acc?.token) openEventStream();
  return { serverBase: acc.serverBase || DEFAULT_SERVER, token: acc.token || '', user: acc.user || null, loggedIn: !!(acc.token) };
});
ipcMain.handle('account:setServer', async (_evt, base) => {
  const acc = readAccount();
  const val = String(base || '').trim() || DEFAULT_SERVER;
  acc.serverBase = val; writeAccount(acc);
  if (acc.token) openEventStream();
  return { ok: true, serverBase: acc.serverBase };
});
ipcMain.handle('account:register', async (_evt, { username, password }) => {
  const acc = readAccount(); const base = (acc.serverBase||'').replace(/\/+$/,'');
  if (!base) return { ok: false, error: 'No server' };
  const { status, json } = await httpPostJson(`${base}/auth/local/register`, { username, password });
  if (status >= 400 || !json?.token) return { ok: false, error: json?.error || 'Register failed' };
  const a = readAccount(); a.token = json.token; writeAccount(a);
  try { const me = await httpGetJson(`${base}/api/me`, { Authorization: `Bearer ${a.token}` }); if (me?.ok && me.user) { a.user = me.user; writeAccount(a); } } catch {}
  await onLoginUnion();
  return { ok: true, user: readAccount().user || null };
});
ipcMain.handle('account:loginLocal', async (_evt, { username, password }) => {
  const acc = readAccount(); const base = (acc.serverBase||'').replace(/\/+$/,'');
  if (!base) return { ok: false, error: 'No server' };
  const { status, json } = await httpPostJson(`${base}/auth/local/login`, { username, password });
  if (status >= 400 || !json?.token) return { ok: false, error: json?.error || 'Login failed' };
  const a = readAccount(); a.token = json.token; writeAccount(a);
  try { const me = await httpGetJson(`${base}/api/me`, { Authorization: `Bearer ${a.token}` }); if (me?.ok && me.user) { a.user = me.user; writeAccount(a); } } catch {}
  await onLoginUnion();
  return { ok: true, user: readAccount().user || null };
});
ipcMain.handle('account:loginDiscord', async () => {
  const acc = readAccount(); const base = (acc.serverBase || '').replace(/\/+$/,'');
  if (!base) return { ok: false, error: 'No server' };

  // Nonce ties the callback to this login attempt so another local process
  // can't inject an attacker token into the loopback listener.
  const stateNonce = crypto.randomBytes(16).toString('hex');
  const srv = http.createServer((req, res) => {
    try {
      // A legitimate browser redirect is a top-level GET with no Origin header.
      if (req.headers.origin) { res.statusCode = 403; res.end('Forbidden'); return; }
      const u = new URL(req.url, `http://${req.headers.host}`);
      if (u.pathname === '/callback' && u.searchParams.get('state') === stateNonce) {
        const token = u.searchParams.get('token') || '';
        if (token) {
          const a = readAccount(); a.token = token; writeAccount(a);
          res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<h3>Login complete. You can close this window.</h3>');
          srv.close(); return;
        }
      }
      res.statusCode = 400; res.end('Bad request');
    } catch { res.statusCode = 500; res.end('Error'); }
  });

  await new Promise((resolve, reject) => { srv.listen(0, '127.0.0.1', resolve); srv.on('error', reject); });
  const port = srv.address().port;
  const redirect = `http://127.0.0.1:${port}/callback?state=${stateNonce}`;
  if (!await openSafeExternal(`${base}/auth/discord?redirect_uri=${encodeURIComponent(redirect)}`)) {
    try { srv.close(); } catch {}
    return { ok: false, error: 'Invalid authentication server URL' };
  }

  const result = await new Promise((resolve) => {
    const t = setTimeout(() => { try { srv.close(); } catch {} resolve({ ok: false, error: 'Timeout' }); }, 120000);
    srv.on('close', async () => {
      clearTimeout(t);
      const a = readAccount();
      if (!a.token) return resolve({ ok: false, error: 'Login failed' });
      try { const me = await httpGetJson(`${base}/api/me`, { Authorization: `Bearer ${a.token}` }); if (me?.ok && me.user) { a.user = me.user; writeAccount(a); } } catch {}
      await onLoginUnion();
      resolve({ ok: true, user: readAccount().user || null });
    });
  });
  return result;
});
ipcMain.handle('account:linkDiscord', async () => {
  try {
    const acc = readAccount();
    if (!acc.serverBase || !acc.token) return { ok: false, error: 'Not logged in' };
    const base = (acc.serverBase || '').replace(/\/+$/,'');
    const stateNonce = crypto.randomBytes(16).toString('hex');
    const srv = http.createServer((req, res) => {
      try {
        if (req.headers.origin) { res.statusCode = 403; res.end('Forbidden'); return; }
        const u = new URL(req.url, `http://${req.headers.host}`);
        if (u.pathname === '/callback' && u.searchParams.get('state') === stateNonce) {
          const linked = u.searchParams.get('linked') === '1';
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end('<h3>Discord linking complete. You can close this window.</h3>');
          srv._linked = linked;
          srv.close();
          return;
        }
        res.statusCode = 400; res.end('Bad request');
      } catch { res.statusCode = 500; res.end('Error'); }
    });

    await new Promise((resolve, reject) => { srv.listen(0, '127.0.0.1', resolve); srv.on('error', reject); });
    const port = srv.address().port;
    const next = `http://127.0.0.1:${port}/callback?state=${stateNonce}`;

    const startUrl = `${base}/api/link/discord/start?next=${encodeURIComponent(next)}`;
    const linkStart = await new Promise((resolve) => {
      const request = net.request({ url: startUrl, method: 'GET' });
      request.setHeader('Accept', 'application/json');
      request.setHeader('Authorization', `Bearer ${acc.token}`);
      let data = '';
      request.on('response', (r) => { r.on('data', (c) => data += c); r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } }); });
      request.on('error', () => resolve(null));
      request.end();
    });
    if (!linkStart || !linkStart.ok || !linkStart.url) { try { srv.close(); } catch {} return { ok: false, error: 'Server refused link start' }; }

    if (!await openSafeExternal(linkStart.url)) {
      try { srv.close(); } catch {}
      return { ok: false, error: 'Invalid Discord link URL' };
    }

    const result = await new Promise((resolve) => {
      const t = setTimeout(() => { try { srv.close(); } catch {} resolve({ ok: true, linked: false, timeout: true }); }, 120000);
      srv.on('close', () => { clearTimeout(t); resolve({ ok: true, linked: !!srv._linked }); });
    });

    if (result.ok && result.linked) {
      try {
        const a = readAccount();
        const me = await httpGetJson(`${base}/api/me`, { Authorization: `Bearer ${a.token}` });
        if (me?.ok && me.user) { a.user = me.user; writeAccount(a); }
      } catch {}
    }

    return { ok: true, linked: !!result.linked, user: readAccount().user || null };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
});
ipcMain.handle('account:logout', async () => {
  closeEventStream();
  const acc = readAccount();
  writeAccount({ serverBase: acc.serverBase || DEFAULT_SERVER, token: '', user: null });
  return { ok: true };
});
ipcMain.handle('account:unlinkDiscord', async () => {
  try {
    const acc = readAccount();
    const base = (acc.serverBase || '').replace(/\/+$/, '');
    if (!base || !acc.token) return { ok: false, error: 'Not logged in' };
    const r = await httpPostJson(`${base}/auth/discord/unlink`, {}, { Authorization: `Bearer ${acc.token}` });
    if ((r.status || 0) >= 400) return { ok: false, error: r?.json?.error || 'Unlink failed' };
    try {
      const me = await httpGetJson(`${base}/api/me`, { Authorization: `Bearer ${acc.token}` });
      if (me?.ok) { acc.user = me.user || null; writeAccount(acc); }
    } catch {}
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
});

/* IPC: app info */
ipcMain.handle('app:getVersion', () => app.getVersion());

/* IPC: sync helpers */
ipcMain.handle('sync:onLogin', async () => { await onLoginUnion(); return { ok: true }; });
ipcMain.handle('sync:fav:pull', async () => pullFavoritesMerge());
ipcMain.handle('sites:getRemote', async () => ({ ok: true, sites: await sitesRemoteGet() }));
ipcMain.handle('sites:saveRemote', async (_evt, sites) => sitesRemotePut(sites));
