require('dotenv').config();

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { EventEmitter } = require('events');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const { query, pool } = require('./db');
const { enc, dec } = require('./crypto');
const { sanitizeFavoriteKey, clampPost } = require('./sanitize');
const {
  isBooruHostAllowed,
  isProxyAllowed,
  refererFor,
  refererHeadersFor,
  BOORU_UA
} = require('./refererFor');
const { applyMediaResponseHeaders, buildMediaRequestHeaders } = require('./mediaProxyHeaders');
const { fetchWithAllowedRedirects, readResponseBufferWithLimit } = require('./proxyFetch');
const { createConcurrencyLimit, createRateLimit } = require('./requestGuards');
const app = express();
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');

/* body parser (1 MB, tolerant) */
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') { req.body = {}; return next(); }
  const max = 1024 * 1024;
  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > max) { req.pause(); res.status(413).send('Payload too large'); return; } chunks.push(c); });
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    req.rawBody = raw;
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    let obj = {};
    const tryJson = () => { try { obj = JSON.parse(raw); } catch {} };
    const tryForm = () => { try { obj = Object.fromEntries(new URLSearchParams(raw)); } catch {} };
    if (!raw || !raw.trim()) { req.body = {}; return next(); }
    if (ct.includes('application/json')) { tryJson(); if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).length === 0) tryForm(); }
    else if (ct.includes('application/x-www-form-urlencoded')) { tryForm(); if (!obj || typeof obj !== 'object' || Array.isArray(obj)) tryJson(); }
    else { tryJson(); if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).length === 0) tryForm(); }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) obj = {};
    req.body = obj; next();
  });
  req.on('error', () => next());
});

/* Never log query strings: proxied upstream URLs may contain API credentials. A busy
   feed proxies a thumbnail per card, so logging every request buries anything useful —
   report what failed, and set LOG_REQUESTS=1 when you want the lot. */
const LOG_ALL_REQUESTS = process.env.LOG_REQUESTS === '1';
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.once('finish', () => {
    if (!LOG_ALL_REQUESTS && res.statusCode < 400) return;
    try { console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - startedAt}ms`); } catch {}
  });
  next();
});

/* ---------- config ---------- */
const PORT = Number(process.env.PORT || 3000);
const HOST = String(process.env.HOST || '0.0.0.0');
const STATIC_BASE_URL = String(process.env.BASE_URL || '').replace(/\/+$/, '');
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const MAX_MEDIA_BYTES = Math.max(1, Number(process.env.MAX_MEDIA_BYTES || 512 * 1024 * 1024));
const MAX_API_PROXY_BYTES = Math.max(1, Number(process.env.MAX_API_PROXY_BYTES || 10 * 1024 * 1024));

const WEAK_SECRETS = new Set(['dev_secret', 'change_me_to_a_long_random_string', 'secret', 'changeme']);
const secretIsWeak = (value) => !value || WEAK_SECRETS.has(value) || /change_me/i.test(value) || value.length < 16;
const isLocalDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test' || process.env.SB_DEV === '1';
function guardSecret(name, value, consequence) {
  if (!secretIsWeak(value)) return;
  if (process.env[`ALLOW_INSECURE_${name}`] !== '1' && !isLocalDev) {
    throw new Error(`${name} must be a strong random value (>= 16 chars, not a placeholder). Set ALLOW_INSECURE_${name}=1 for local development only.`);
  }
  console.warn(`[security] ${name} is weak or a placeholder — ${consequence}. Do not use this in production.`);
}
guardSecret('JWT_SECRET', JWT_SECRET, 'issued tokens are forgeable');
// crypto.getKey() already refuses anything under 16 chars, but a long placeholder is just as
// public, and failing here beats failing on the first credential write.
guardSecret('ENC_SECRET', process.env.ENC_SECRET || '', 'stored site credentials are weakly encrypted');

const authRateLimit = createRateLimit({ windowMs: 10 * 60_000, max: 30, label: 'authentication' });
const apiProxyRateLimit = createRateLimit({ windowMs: 60_000, max: 120, label: 'booru proxy' });
const mediaRateLimit = createRateLimit({ windowMs: 60_000, max: 240, label: 'media proxy' });
const mediaConcurrencyLimit = createConcurrencyLimit({ maxGlobal: 60, maxPerClient: 8, label: 'media proxy' });
const countsRateLimit = createRateLimit({ windowMs: 60_000, max: 120, label: 'favourite counts' });

app.use(['/auth/local/register', '/auth/local/login', '/auth/discord'], authRateLimit);

/* ---------- utils ---------- */
function publicBase(req) {
  if (STATIC_BASE_URL) return STATIC_BASE_URL;
  const host = String(req.headers['host'] || '').trim();
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() || 'http';
  if (!host) return `${proto}://localhost:${PORT}`;
  return `${proto}://${host}`;
}
function oauthRedirectBase(req) { return `${publicBase(req)}/auth/discord/callback`; }
function signToken(user) { return jwt.sign({ sub: user.id, name: user.username || '', avatar: user.avatar || '' }, JWT_SECRET, { expiresIn: '90d' }); }
function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/.exec(h);
    if (!m) return res.status(401).json({ ok: false, error: 'missing token' });
    const decd = jwt.verify(m[1], JWT_SECRET, { algorithms: ['HS256'] });
    // stream tickets travel in a URL, so they must not double as full API credentials
    if (decd.scope) return res.status(401).json({ ok: false, error: 'invalid token' });
    req.user = { id: decd.sub, name: decd.name || '', avatar: decd.avatar || '' };
    next();
  } catch {
    res.status(401).json({ ok: false, error: 'invalid token' });
  }
}
function cryptoRandomId() { return crypto.randomBytes(16).toString('hex'); }
function isAllowedDeepLink(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  try {
    const parsed = new URL(u);
    if (parsed.protocol === 'streambooru:' && parsed.hostname === 'oauth') {
      return parsed.pathname === '/discord' || parsed.pathname === '/linked';
    }
    if (parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')) {
      return parsed.pathname === '/callback' && /^\d+$/.test(parsed.port);
    }
    if (STATIC_BASE_URL && parsed.origin === new URL(STATIC_BASE_URL).origin) return true;
  } catch {}
  return false;
}

function webAppRoot() {
  const candidates = [
    path.join(__dirname, '../webapp'),
    path.join(__dirname, '../../renderer')
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return null;
}

function oauthCallbackUrl(req, params = {}) {
  const u = new URL('/oauth-callback', publicBase(req));
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function redirectOAuthResult(req, res, next, params) {
  if (next && isAllowedDeepLink(next)) {
    const u = new URL(next);
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') u.searchParams.set(k, String(v));
    }
    return res.redirect(u.toString());
  }
  return res.redirect(oauthCallbackUrl(req, params));
}

/* helpers */
function bodyObj(req) { const b = req.body; return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; }

/* ---------- per-user bus (SSE) ---------- */
const userBus = new Map();
function chanFor(uid) { if (!userBus.has(uid)) userBus.set(uid, new EventEmitter()); return userBus.get(uid); }
function emitTo(uid, event, payload) { try { chanFor(uid).emit('event', { event, payload, ts: Date.now() }); } catch {} }

function wantsHealthHtml(req) {
  if (String(req.query.format || '').toLowerCase() === 'json') return false;
  const accept = String(req.headers.accept || '').toLowerCase();
  if (!accept || accept === '*/*') return false;
  return accept.includes('text/html');
}

async function collectHealth() {
  const ts = Date.now();
  let db = { ok: false, latencyMs: null };
  try {
    const t0 = Date.now();
    await query('SELECT 1 AS ok');
    db = { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    db = { ok: false, latencyMs: null, error: String(e?.message || e) };
  }
  const ok = db.ok;
  return {
    ok,
    ts,
    db,
    uptime: Math.floor(process.uptime()),
    discord: { configured: !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET) },
    webapp: !!webAppRoot()
  };
}

/* ---------- health ---------- */
app.get('/health', async (req, res) => {
  if (wantsHealthHtml(req)) {
    const page = path.join(__dirname, '../public/health.html');
    if (fs.existsSync(page)) return res.sendFile(page);
  }
  try {
    const status = await collectHealth();
    res.status(status.ok ? 200 : 503).json(status);
  } catch (e) {
    res.status(503).json({ ok: false, ts: Date.now(), error: String(e?.message || e) });
  }
});

/* ---------- local accounts ---------- */
app.post('/auth/local/register', async (req, res) => {
  try {
    const b = bodyObj(req);
    const username = String(b.username || '').trim();
    const password = String(b.password || '');
    if (!username || username.length < 3) return res.status(400).json({ ok: false, error: 'bad username' });
    if (!password || password.length < 6) return res.status(400).json({ ok: false, error: 'bad password' });

    const rs = await query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username]);
    if (rs.rowCount > 0) return res.status(409).json({ ok: false, error: 'username taken' });

    const id = 'local:' + cryptoRandomId();
    const hash = await bcrypt.hash(password, 12);
    const created_at = Date.now();
    await query(`INSERT INTO users (id, username, avatar, created_at, password_hash) VALUES ($1, $2, '', $3, $4)`,
      [id, username, created_at, hash]);

    const token = signToken({ id, username, avatar: '' });
    res.json({ ok: true, token });
  } catch (e) {
    console.error('Register error:', e?.message || e);
    res.status(500).json({ ok: false });
  }
});

app.post('/auth/local/login', async (req, res) => {
  try {
    const b = bodyObj(req);
    const username = String(b.username || '').trim();
    const password = String(b.password || '');
    if (!username || !password) return res.status(400).json({ ok: false, error: 'missing credentials' });

    const r = await query(
      `SELECT id, username, avatar, password_hash
       FROM users
       WHERE lower(username) = lower($1) OR id = $1
       LIMIT 1`,
      [username]
    );
    const row = r.rows[0];
    if (!row) return res.status(401).json({ ok: false, error: 'invalid credentials' });
    if (!row.password_hash) return res.status(409).json({ ok: false, error: 'no password set' });

    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: 'invalid credentials' });

    const token = signToken({ id: row.id, username: row.username, avatar: row.avatar || '' });
    res.json({ ok: true, token });
  } catch (e) {
    console.error('Login error:', e?.message || e);
    res.status(500).json({ ok: false, error: 'server error' });
  }
});

/* ---------- discord oauth (login + link) ---------- */
app.get('/auth/discord', (req, res) => {
  const oauthRedirect = oauthRedirectBase(req);
  const next = String(req.query.redirect_uri || '').trim();
  const stateToken = jwt.sign({ purpose: 'login', next, iat: Math.floor(Date.now() / 1000) }, JWT_SECRET, { expiresIn: '10m' });
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID || '',
    redirect_uri: oauthRedirect,
    response_type: 'code',
    scope: 'identify',
    prompt: 'consent',
    state: stateToken
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});
app.get('/api/link/discord/start', auth, async (req, res) => {
  try {
    const oauthRedirect = oauthRedirectBase(req);
    const next = String(req.query.next || '').trim();
    const stateToken = jwt.sign({ purpose: 'link', linkTo: req.user.id, next, iat: Math.floor(Date.now() / 1000) }, JWT_SECRET, { expiresIn: '10m' });
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID || '',
      redirect_uri: oauthRedirect,
      response_type: 'code',
      scope: 'identify',
      prompt: 'consent',
      state: stateToken
    });
    res.json({ ok: true, url: `https://discord.com/api/oauth2/authorize?${params.toString()}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});
app.get('/auth/discord/callback', async (req, res) => {
  try {
    const oauthRedirect = oauthRedirectBase(req);
    const code = String(req.query.code || '');
    const stateRaw = String(req.query.state || '');
    if (!code) return res.status(400).send('Missing code');

    let state = {}; try { state = jwt.verify(stateRaw, JWT_SECRET, { algorithms: ['HS256'] }); } catch { state = {}; }

    const tokRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID || '',
        client_secret: process.env.DISCORD_CLIENT_SECRET || '',
        grant_type: 'authorization_code',
        code, redirect_uri: oauthRedirect
      })
    });
    if (!tokRes.ok) return res.status(400).send('Token exchange failed');
    const tokJson = await tokRes.json();
    const access_token = tokJson.access_token;
    if (!access_token) return res.status(400).send('No access_token');

    const meRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
    if (!meRes.ok) return res.status(400).send('Failed to fetch user');
    const me = await meRes.json();
    const discordId = String(me.id);
    const profile = { username: me.username || '', avatar: me.avatar || '' };

    if (state.purpose === 'link' && state.linkTo) {
      try {
        await query('UPDATE users SET discord_id = $1, username = COALESCE(username, $2) WHERE id = $3', [discordId, profile.username, state.linkTo]);
      } catch {
        return res.status(409).send('This Discord is already linked to another account.');
      }
      const next = String(state.next || '');
      return redirectOAuthResult(req, res, next, { linked: '1' });
    }

    const found = await query('SELECT id, username, avatar FROM users WHERE discord_id = $1', [discordId]);
    let userId;
    let sessionUser = { username: profile.username, avatar: profile.avatar };
    if (found.rowCount > 0) {
      userId = found.rows[0].id;
      const updated = await query(
        `UPDATE users SET avatar = $2,
         username = CASE WHEN password_hash IS NOT NULL AND password_hash <> '' THEN username ELSE $1 END
         WHERE id = $3
         RETURNING username, avatar`,
        [profile.username, profile.avatar, userId]
      );
      if (updated.rows[0]) {
        sessionUser = {
          username: updated.rows[0].username || profile.username,
          avatar: updated.rows[0].avatar || profile.avatar
        };
      }
    } else {
      userId = `discord:${discordId}`;
      const created_at = Date.now();
      await query(`INSERT INTO users (id, username, avatar, created_at, discord_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [userId, profile.username, profile.avatar, created_at, discordId]);
    }
    const jwtToken = signToken({ id: userId, username: sessionUser.username, avatar: sessionUser.avatar });

    const next = String(state.next || '');
    return redirectOAuthResult(req, res, next, { token: jwtToken });
  } catch (e) {
    console.error('Discord callback error:', e?.message || e);
    res.status(500).send('Auth error');
  }
});

app.post('/auth/discord/unlink', auth, async (req, res) => {
  try {
    await query('UPDATE users SET discord_id = NULL WHERE id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('Discord unlink error:', e?.message || e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/* ---------- user/me ---------- */
app.get('/api/me', auth, async (req, res) => {
  const r = await query('SELECT id, username, avatar, discord_id FROM users WHERE id = $1', [req.user.id]);
  const u = r.rows[0] || { id: req.user.id, username: req.user.name, avatar: '' };
  res.json({ ok: true, user: { id: u.id, name: u.username || '', avatar: u.avatar || '', discord_id: u.discord_id || null } });
});

/* ---------- favourites (British + US spellings share one handler) ---------- */
const FAV_KEYS_PATHS = ['/api/favourites/keys', '/api/favorites/keys'];
const FAV_LIST_PATHS = ['/api/favourites', '/api/favorites'];
const FAV_KEY_PATHS = ['/api/favourites/:key', '/api/favorites/:key'];
const FAV_BULK_PATHS = ['/api/favourites/bulk_upsert', '/api/favorites/bulk_upsert'];
const FAV_TOMBSTONE_MS = 180 * 24 * 60 * 60 * 1000;

app.get(FAV_KEYS_PATHS, auth, async (req, res) => {
  const r = await query('SELECT key FROM favorites WHERE user_id = $1 ORDER BY added_at DESC', [req.user.id]);
  res.json({ ok: true, keys: r.rows.map(x => x.key) });
});
app.get(FAV_LIST_PATHS, auth, async (req, res) => {
  const r = await query('SELECT key, added_at, post_json FROM favorites WHERE user_id = $1 ORDER BY added_at DESC', [req.user.id]);
  const items = r.rows.map(row => ({ key: row.key, added_at: Number(row.added_at) || 0, post: row.post_json })).filter(x => x.post);
  // Sync is the only reader of the tombstones, so it is also where they get trimmed. A device
  // offline for longer than this can still resurrect what it holds.
  await query('DELETE FROM favorite_deletions WHERE user_id = $1 AND deleted_at < $2', [req.user.id, Date.now() - FAV_TOMBSTONE_MS]);
  const d = await query('SELECT key, deleted_at FROM favorite_deletions WHERE user_id = $1', [req.user.id]);
  const deletions = d.rows.map(row => ({ key: row.key, deleted_at: Number(row.deleted_at) || 0 }));
  res.json({ ok: true, items, deletions });
});
app.put(FAV_KEY_PATHS, auth, async (req, res) => {
  try {
    const key = sanitizeFavoriteKey(req.params.key);
    const post = clampPost(bodyObj(req)?.post);
    if (!key || !post) return res.status(400).json({ ok: false, error: 'bad key/post' });
    const added_at = Number(bodyObj(req)?.added_at) || Date.now();
    // Faving again is deliberate, so it clears any tombstone from an earlier unfave.
    await query('DELETE FROM favorite_deletions WHERE user_id = $1 AND key = $2', [req.user.id, key]);
    await query(`
      INSERT INTO favorites (user_id, key, added_at, post_json)
      VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT(user_id, key) DO UPDATE SET added_at = EXCLUDED.added_at, post_json = EXCLUDED.post_json
    `, [req.user.id, key, added_at, post]);
    emitTo(req.user.id, 'fav_changed', { key, added_at });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});
app.delete(FAV_KEY_PATHS, auth, async (req, res) => {
  try {
    const key = sanitizeFavoriteKey(req.params.key);
    if (!key) return res.status(400).json({ ok: false, error: 'bad key' });
    const deleted_at = Date.now();
    await query('DELETE FROM favorites WHERE user_id = $1 AND key = $2', [req.user.id, key]);
    await query(`
      INSERT INTO favorite_deletions (user_id, key, deleted_at) VALUES ($1, $2, $3)
      ON CONFLICT(user_id, key) DO UPDATE SET deleted_at = EXCLUDED.deleted_at
    `, [req.user.id, key, deleted_at]);
    emitTo(req.user.id, 'fav_changed', { key, removed: true, deleted_at });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});
app.post(FAV_BULK_PATHS, auth, async (req, res) => {
  try {
    const items = Array.isArray(bodyObj(req).items) ? bodyObj(req).items : [];
    const now = Date.now();
    const keys = [], addedAts = [], posts = [];
    for (const it of items) {
      const key = sanitizeFavoriteKey(it?.key);
      const post = clampPost(it?.post);
      if (!key || !post) continue;
      keys.push(key);
      addedAts.push(Number(it?.added_at) || now);
      posts.push(JSON.stringify(post));
    }
    let upserted = 0;
    if (keys.length) {
      // A fave newer than the tombstone is a real re-fave, so it clears the tombstone. Anything
      // older is a lagging client pushing back what another device deleted, and is dropped here
      // rather than trusting the client to have checked.
      await query(`
        DELETE FROM favorite_deletions d
        USING unnest($2::text[], $3::bigint[]) AS t(k, a)
        WHERE d.user_id = $1 AND d.key = t.k AND d.deleted_at < t.a
      `, [req.user.id, keys, addedAts]);
      // one round trip instead of a query per favourite
      const r = await query(`
        INSERT INTO favorites (user_id, key, added_at, post_json)
        SELECT $1, k, a, p::jsonb FROM unnest($2::text[], $3::bigint[], $4::text[]) AS t(k, a, p)
        WHERE NOT EXISTS (SELECT 1 FROM favorite_deletions d WHERE d.user_id = $1 AND d.key = t.k)
        ON CONFLICT (user_id, key) DO UPDATE SET added_at = EXCLUDED.added_at, post_json = EXCLUDED.post_json
      `, [req.user.id, keys, addedAts, posts]);
      upserted = r.rowCount || 0;
    }
    if (upserted) emitTo(req.user.id, 'fav_changed', { bulk: true, count: upserted, at: Date.now() });
    res.json({ ok: true, upserted, skipped: keys.length - upserted });
  } catch {
    res.status(500).json({ ok: false });
  }
});

/* ---------- public favourite counts (no auth: aggregate only) ---------- */
app.post('/api/favourites/counts', countsRateLimit, async (req, res) => {
  try {
    const raw = bodyObj(req)?.keys;
    const keys = [...new Set((Array.isArray(raw) ? raw : [])
      .map((k) => sanitizeFavoriteKey(k))
      .filter(Boolean))].slice(0, 200);
    if (keys.length === 0) return res.json({ ok: true, counts: {} });
    const r = await query('SELECT key, COUNT(*)::int AS n FROM favorites WHERE key = ANY($1) GROUP BY key', [keys]);
    const counts = {};
    for (const row of r.rows) counts[row.key] = Number(row.n) || 0;
    res.json({ ok: true, counts });
  } catch {
    res.status(500).json({ ok: false });
  }
});

/* ---------- sites ---------- */
function normBaseUrl(u) {
  try { const url = new URL(String(u || '').trim()); url.hash = ''; url.search = ''; return url.toString().replace(/\/+$/, ''); }
  catch { return String(u || '').replace(/\/+$/, ''); }
}

app.get('/api/sites', auth, async (req, res) => {
  const r = await query(`
    SELECT site_id, name, type, base_url, rating, tags, query_dialect, credentials_enc, order_index, enabled
    FROM user_sites WHERE user_id = $1 ORDER BY order_index ASC, created_at ASC
  `, [req.user.id]);
  const sites = r.rows.map(row => {
    const creds = dec(row.credentials_enc) || {};
    return {
      id: row.site_id,
      name: row.name,
      type: row.type,
      baseUrl: row.base_url,
      rating: row.rating,
      tags: row.tags,
      queryDialect: row.query_dialect || 'auto',
      enabled: row.enabled !== false,
      credentials: creds,
      order_index: row.order_index
    };
  });
  res.json({ ok: true, sites });
});

app.put('/api/sites', auth, async (req, res) => {
  try {
    const listRaw = bodyObj(req)?.sites;
    const list = Array.isArray(listRaw) ? listRaw : [];
    if (list.length > 200) return res.status(400).json({ ok: false, error: 'too many sites' });

    // Explicit sanitization: accept baseUrl or base_url and preserve credentials object
    const sanitized = list.map((s, idx) => {
      const type = String(s.type || '').toLowerCase().slice(0, 40);
      const base_url = normBaseUrl(s.base_url || s.baseUrl || '');
      const name = String(s.name || '').slice(0, 200);
      const rating = String(s.rating || 'safe').slice(0, 40);
      const tags = String(s.tags || '').slice(0, 800);
      const requestedDialect = String(s.queryDialect || s.query_dialect || 'auto').toLowerCase();
      const query_dialect = ['auto', 'gelbooru', 'rule34'].includes(requestedDialect) ? requestedDialect : 'auto';
      const order_index = Number(s.order_index ?? idx) || idx;
      const enabled = s.enabled !== false && s.enabled !== 'false';

      const credIn = (s && typeof s.credentials === 'object' && !Array.isArray(s.credentials)) ? s.credentials : {};
      const credentials = {};
      if (type === 'danbooru') {
        credentials.login = String(credIn.login || '').slice(0, 200);
        credentials.api_key = String(credIn.api_key || '').slice(0, 400);
      } else if (type === 'moebooru') {
        credentials.login = String(credIn.login || '').slice(0, 200);
        credentials.password_hash = String(credIn.password_hash || '').slice(0, 400);
      } else {
        // pass through primitive creds
        Object.entries(credIn).forEach(([k,v]) => {
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            credentials[String(k).slice(0, 100)] = String(v).slice(0, 400);
          }
        });
      }
      return { name, type, base_url, rating, tags, query_dialect, order_index, enabled, credentials };
    }).filter(s => s.type && s.base_url);

    const now = Date.now();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM user_sites WHERE user_id = $1', [req.user.id]);
      for (let i = 0; i < sanitized.length; i++) {
        const s = sanitized[i];
        const credsEnc = enc(s.credentials || {});
        const site_id = cryptoRandomId();
        await client.query(`
          INSERT INTO user_sites (site_id, user_id, name, type, base_url, rating, tags, query_dialect, credentials_enc, order_index, enabled, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)
        `, [site_id, req.user.id, s.name, s.type, s.base_url, s.rating, s.tags, s.query_dialect, credsEnc, s.order_index ?? i, s.enabled !== false, now, now]);
      }
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      if (String(e.message || '').includes('user_sites_user_type_base_uniq')) {
        return res.status(409).json({ ok: false, error: 'duplicate site (type+baseUrl)' });
      }
      throw e;
    } finally {
      client.release();
    }
    emitTo(req.user.id, 'sites_changed', { count: sanitized.length, at: Date.now() });
    res.json({ ok: true, count: sanitized.length });
  } catch (e) {
    console.error('sites put error', e);
    res.status(500).json({ ok: false });
  }
});

/* ---------- SSE ---------- */
// EventSource cannot send headers, so browsers have to put a credential in the URL where
// proxy and CDN access logs will keep it. Hand them a minute-long stream-only ticket instead.
app.post('/api/stream/ticket', auth, (req, res) => {
  res.json({ ok: true, ticket: jwt.sign({ sub: req.user.id, scope: 'stream' }, JWT_SECRET, { expiresIn: '60s' }) });
});
function authFromHeaderOrQuery(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  const ticket = String(req.query.ticket || '');
  // older clients still pass a full token in the query string
  const token = m ? m[1] : (ticket || String(req.query.access_token || req.query.token || ''));
  if (!token) throw new Error('missing token');
  const decd = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  if (ticket && decd.scope !== 'stream') throw new Error('invalid ticket');
  if (!ticket && decd.scope) throw new Error('invalid token');
  return { id: decd.sub, name: decd.name || '', avatar: decd.avatar || '' };
}
app.get('/api/stream', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');

  let user;
  try { user = authFromHeaderOrQuery(req); }
  catch { res.status(401).end('Unauthorized'); return; }

  const uid = user.id;
  const ch = chanFor(uid);

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data || {})}\n\n`);
    } catch {}
  };

  const onEvt = (e) => send(e.event, e.payload || {});
  ch.on('event', onEvt);

  const ping = setInterval(() => send('ping', { ts: Date.now() }), 25000);
  req.on('close', () => { clearInterval(ping); ch.off('event', onEvt); });

  send('hello', { ok: true, ts: Date.now() });
});

/* ---------- Media proxy (images + video) ---------- */

async function proxyMediaRequest(req, res, { download = false, filename = '' } = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Vary', 'Origin');
  try {
    const url = String(req.query.url || '');
    if (!url || !isProxyAllowed(url)) return res.status(400).send('Bad url');

    const refParam = String(req.query.ref || '').trim();
    const accept = String(req.query.accept || '').trim() ||
      'image/avif,image/webp,image/apng,image/*,video/*,application/octet-stream,*/*;q=0.8';

    const hdr = buildMediaRequestHeaders({
      url,
      accept,
      ref: refParam,
      range: String(req.headers.range || '').trim()
    });

    const r = await fetchWithAllowedRedirects(url, { headers: hdr }, isProxyAllowed);
    if (!r.ok) {
      res.status(r.status).end(`Upstream ${r.status}`);
      return;
    }

    const contentLength = Number(r.headers.get('content-length') || 0);
    if (contentLength > MAX_MEDIA_BYTES) {
      try { await r.body?.cancel(); } catch {}
      return res.status(413).end('Upstream media is too large');
    }

    res.status(r.status);
    applyMediaResponseHeaders(res, r, { download, filename });

    if (r.body) {
      let transferred = 0;
      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          transferred += chunk.length;
          if (transferred > MAX_MEDIA_BYTES) return callback(new Error('Upstream media exceeded byte limit'));
          callback(null, chunk);
        }
      });
      await pipeline(Readable.fromWeb(r.body), limiter, res);
    }
    else res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error('mediaproxy error', e);
    if (!res.headersSent) res.status(e?.code === 'PROXY_TARGET_DENIED' ? 400 : 502).end('proxy error');
    else res.destroy();
  }
}

app.get('/imgproxy', mediaRateLimit, mediaConcurrencyLimit, (req, res) => proxyMediaRequest(req, res));

app.get('/mediaproxy', mediaRateLimit, mediaConcurrencyLimit, (req, res) => {
  const download = String(req.query.download || '') === '1';
  const filename = String(req.query.filename || '');
  return proxyMediaRequest(req, res, { download, filename });
});

/* ---------- Booru API proxy (web browser CORS bypass) ---------- */
function setBooruProxyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
  res.setHeader('Vary', 'Origin');
}

app.options('/api/booru/fetch', (req, res) => {
  setBooruProxyCors(res);
  res.status(204).end();
});

app.get('/api/booru/fetch', apiProxyRateLimit, async (req, res) => {
  setBooruProxyCors(res);
  try {
    const url = String(req.query.url || '');
    if (!url || !isBooruHostAllowed(url)) {
      return res.status(400).json({ ok: false, error: 'url not allowed' });
    }

    const accept = String(req.query.accept || 'application/json, text/plain, */*');
    const hdr = {
      'User-Agent': BOORU_UA,
      Accept: accept,
    };

    const ref = refererFor(url);
    if (ref) {
      hdr.Referer = ref;
      try { hdr.Origin = new URL(ref).origin; } catch { hdr.Origin = ref; }
    }

    const upstream = await fetchWithAllowedRedirects(url, { headers: hdr }, isBooruHostAllowed);
    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    const body = await readResponseBufferWithLimit(upstream, MAX_API_PROXY_BYTES);

    res.status(upstream.status);
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.end(body);
  } catch (e) {
    console.error('booru fetch proxy error', e?.message || e);
    const status = e?.code === 'PROXY_TARGET_DENIED' ? 400 : e?.code === 'PROXY_BODY_LIMIT' ? 413 : 502;
    res.status(status).json({ ok: false, error: status === 413 ? 'upstream response is too large' : 'proxy error' });
  }
});

/* ---------- static: landing + web app ---------- */
const publicDir = path.join(__dirname, '../public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir, { index: false, maxAge: '1h' }));
  app.get('/', (_req, res) => {
    const landing = path.join(publicDir, 'index.html');
    if (fs.existsSync(landing)) return res.sendFile(landing);
    res.redirect('/app/');
  });
  app.get('/oauth-callback', (_req, res) => {
    const page = path.join(publicDir, 'oauth-callback.html');
    if (fs.existsSync(page)) return res.sendFile(page);
    res.status(404).send('OAuth callback page missing');
  });
  // Cloudflare is set to build error responses from this path, so it fetches it here for
  // every 4xx and 5xx. With no route it 404s and visitors get Express's "Cannot GET
  // /custom_error" as the body of the error. It has to answer 200 to be used as a page.
  app.get('/custom_error', (_req, res) => {
    const page = path.join(publicDir, 'custom_error.html');
    if (fs.existsSync(page)) return res.sendFile(page);
    res.type('text/plain').send('StreamBooru could not complete that request.');
  });
}

const webRoot = webAppRoot();
if (webRoot) {
  app.use('/app', express.static(webRoot, { index: 'index.html', maxAge: '1h' }));
  app.get('/app', (_req, res) => res.sendFile(path.join(webRoot, 'index.html')));
  console.log(`Web app served from ${webRoot} at /app/`);
} else {
  console.warn('Web app not found (copy renderer to server/webapp for /app/)');
}

/* ---------- start ---------- */
function startServer(port = PORT, host = HOST) {
  const server = app.listen(port, host, () => {
    const address = server.address();
    const actualPort = address && typeof address === 'object' ? address.port : port;
    const pub = STATIC_BASE_URL || `http://${host === '0.0.0.0' ? 'localhost' : host}:${actualPort}`;
    console.log(`Sync server listening on ${host}:${actualPort} (public base: ${pub})`);
  });
  return server;
}

module.exports = { app, startServer };
