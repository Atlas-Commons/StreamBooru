// Renderer with Search/New/Popular/Favorites, Manage Sites, Settings,
// bulk download, filename templates and tag autocomplete

const DEFAULT_SETTINGS = {
  theme: 'dark',          // 'dark' | 'light'
  density: 'cozy',        // 'compact' | 'cozy' | 'comfortable'
  cardFit: 'cover',       // 'cover' | 'natural'
  autoplayVideoThumbs: true,
  blurUnsafe: false
};

const state = {
  config: { sites: [] },
  settings: { ...DEFAULT_SETTINGS },
  viewType: 'new',
  cursors: {},
  items: [],
  loading: false,
  search: '',

  // Aggregation
  searchBuckets: new Map(),
  searchSeen: new Set(),
  searchOrder: [],
  feedSeen: new Set(),
  rrCursor: 0,

  // Track which sites have no more pages
  endedSites: new Set(),

  // Flow control
  noMoreResults: false,
  pendingFetch: false,
  fetchGen: 0,

  // Cache per tab for instant tab switching (short TTL so feeds stay fresh)
  viewCache: {
    new: { items: [], cursors: {}, feedSeen: new Set(), rrCursor: 0, search: '', endedSites: new Set(), noMoreResults: false, cachedAt: 0, stale: false },
    popular: { items: [], cursors: {}, search: '', endedSites: new Set(), noMoreResults: false, cachedAt: 0 },
    search: { items: [], cursors: {}, search: '', searchBuckets: new Map(), searchSeen: new Set(), endedSites: new Set(), noMoreResults: false, cachedAt: 0 },
    faves: { items: [], search: '', cachedAt: 0 }
  },

  // While scrolling, lock ordering to avoid moving items above you
  orderLock: false,

  // File naming
  nameTemplate: null,

  // IO for infinite scroll sentinel
  _io: null
};

// ---------- utils ----------
// memoized: itemKey/siteKey run this in every dedupe and render loop
const baseUrlCache = new Map();
function normalizeBaseUrl(u) {
  const raw = String(u || '');
  let v = baseUrlCache.get(raw);
  if (v === undefined) {
    try { const url = new URL(raw.trim()); url.hash = ''; url.search = ''; v = url.toString().replace(/\/+$/, ''); }
    catch { v = raw.replace(/\/+$/, ''); }
    if (baseUrlCache.size > 500) baseUrlCache.clear();
    baseUrlCache.set(raw, v);
  }
  return v;
}
function siteKey(site) { return `${site.type}:${normalizeBaseUrl(site.baseUrl || '')}`; }
function itemKey(p) { return `${normalizeBaseUrl(p.site?.baseUrl || '')}#${p.id}`; }
function safeNum(n, d=0) { const v = Number(n); return Number.isFinite(v)?v:d; }
function timeKey(p) {
  const t = p?.created_at ? Date.parse(p.created_at) : NaN;
  if (Number.isFinite(t)) return t;
  const idn = Number(p?.id);
  return Number.isFinite(idn) ? idn : -Infinity;
}
function tagsInclude(p, searchStr) {
  if (!searchStr) return true;
  const wanted = (searchStr || '').split(/\s+/).filter(Boolean);
  if (wanted.length === 0) return true;
  const hay = new Set((p.tags || []).map((t) => String(t).toLowerCase()));
  return wanted.every((t) => hay.has(String(t).toLowerCase()));
}
function notify(message, opts) {
  if (typeof window.toast === 'function') window.toast(message, opts);
  else alert(message);
}
function notifyError(message) { notify(message, { type: 'error' }); }
function configuredSites() {
  return (state.config?.sites || []).filter((s) => s?.baseUrl && s?.type);
}
function enabledSites() {
  return configuredSites().filter((s) => s.enabled !== false);
}

// Robust scroll helpers (Android WebView safe)
function getScrollY() {
  return (typeof window.scrollY === 'number' ? window.scrollY : 0)
      || document.scrollingElement?.scrollTop
      || document.documentElement?.scrollTop
      || document.body?.scrollTop
      || 0;
}
function getScrollHeight() {
  const b = document.body;
  const e = document.documentElement;
  return Math.max(
    b?.scrollHeight || 0, e?.scrollHeight || 0,
    b?.offsetHeight || 0,  e?.offsetHeight || 0,
    b?.clientHeight || 0,  e?.clientHeight || 0
  );
}
function atTop(px = 200) { return getScrollY() <= px; }
function scrollToTop() {
  try {
    (document.scrollingElement || document.documentElement || document.body).scrollTop = 0;
    window.scrollTo(0, 0);
    requestAnimationFrame(() => { try { (document.scrollingElement || document.documentElement || document.body).scrollTop = 0; window.scrollTo(0,0); } catch {} });
  } catch {}
}

// Media activity helper: avoid DOM churn while media is active
function anyMediaActive() {
  try {
    const medias = document.querySelectorAll('video,audio');
    for (const m of medias) {
      if (!m) continue;
      if ((m.readyState >= 2 && !m.paused && !m.ended) || m.seeking) return true;
    }
  } catch {}
  return false;
}

// ---------- settings ----------
function applySettings() {
  const s = state.settings || DEFAULT_SETTINGS;
  document.documentElement.dataset.theme = s.theme === 'light' ? 'light' : 'dark';
  document.body.dataset.density = ['compact', 'cozy', 'comfortable'].includes(s.density) ? s.density : 'cozy';
  document.body.dataset.fit = s.cardFit === 'natural' ? 'natural' : 'cover';
  document.body.dataset.blur = s.blurUnsafe ? 'on' : 'off';
  window.__sbSettings = { ...s };
  relayoutNaturalGrid();
}
window.updateAppSettings = async (patch) => {
  state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}), ...(patch || {}) };
  applySettings();
  await saveConfigPatch({ settings: state.settings });
};

async function saveConfigPatch(patch) {
  state.config = { ...(state.config || {}), ...(patch || {}) };
  try { await window.api.saveConfig(state.config); } catch (e) { console.warn('saveConfig failed', e); }
}

// Popularity helpers
function quantile(a, q) {
  if (!a || a.length === 0) return 0;
  const s = [...a].sort((x,y)=>x-y);
  const pos = (s.length - 1) * Math.min(Math.max(q, 0), 1);
  const b = Math.floor(pos);
  const r = pos - b;
  if (s[b+1] !== undefined) return s[b] + r*(s[b+1]-s[b]);
  return s[b];
}
function buildSiteStats(items) {
  const by = new Map();
  for (const p of items) {
    const k = siteKey(p.site || {});
    if (!by.has(k)) by.set(k, { favs: [], scores: [] });
    const b = by.get(k);
    const f = safeNum(p.favorites, 0);
    const s = safeNum(p.score, 0);
    if (f > 0) b.favs.push(f);
    if (s !== 0) b.scores.push(s);
  }
  const out = new Map();
  for (const [k,v] of by.entries()) {
    out.set(k, { favP95: quantile(v.favs, 0.95) || 0, scoreP95: quantile(v.scores, 0.95) || 0 });
  }
  return out;
}
function recencyBoost(p, now=Date.now()) {
  const t = timeKey(p);
  if (!Number.isFinite(t) || t<=0) return 0;
  const ageH = Math.max(0, (now - t)/3600000);
  const half = 48;
  return Math.exp(-ageH/half);
}
function clamp01(x) { const n = Number(x); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
function computePopularity(items) {
  const stats = buildSiteStats(items);
  const now = Date.now();
  const map = new Map();
  for (const p of items) {
    const sk = siteKey(p.site || {});
    const st = stats.get(sk) || { favP95: 0, scoreP95: 0 };
    const favNorm = st.favP95>0 ? clamp01(safeNum(p.favorites,0)/st.favP95) : 0;
    const scoreNorm = st.scoreP95>0 ? clamp01(safeNum(p.score,0)/st.scoreP95) : 0;
    const pop = 1.0*favNorm + 0.6*scoreNorm + 0.15*recencyBoost(p, now);
    map.set(itemKey(p), Number.isFinite(pop) ? pop : 0);
  }
  return map;
}
function popularCompare(a,b, popMap) {
  const pa = popMap.get(itemKey(a)) ?? 0;
  const pb = popMap.get(itemKey(b)) ?? 0;
  if (pb !== pa) return pb - pa;
  const af = safeNum(a.favorites), bf = safeNum(b.favorites);
  if (bf !== af) return bf - af;
  const as = safeNum(a.score), bs = safeNum(b.score);
  if (bs !== as) return bs - as;
  const ad = timeKey(a), bd = timeKey(b);
  if (bd !== ad) return bd - ad;
  const ak = itemKey(a), bk = itemKey(b);
  return ak < bk ? -1 : ak > bk ? 1 : 0;
}
function newCompare(a,b) {
  const ad = timeKey(a), bd = timeKey(b);
  if (bd !== ad) return bd - ad;
  const af = safeNum(a.favorites), bf = safeNum(b.favorites);
  if (bf !== af) return bf - af;
  const as = safeNum(a.score), bs = safeNum(b.score);
  if (bs !== as) return bs - as;
  return 0;
}
function sortItems(items, viewType) {
  const list = [...items];
  if (viewType === 'popular') {
    const pop = computePopularity(list);
    list.sort((a,b)=>popularCompare(a,b,pop));
  } else if (viewType === 'new') {
    list.sort(newCompare);
  } else if (viewType === 'faves') {
    list.sort((a,b)=>{
      const al = a._added_at || 0, bl = b._added_at || 0;
      if (bl !== al) return bl - al;
      const ad = timeKey(a), bd = timeKey(b);
      if (bd !== ad) return bd - ad;
      return 0;
    });
  }
  return list;
}
function interleaveRoundRobin(orderKeys, buckets) {
  const arrays = orderKeys.map((k)=> buckets.get(k) || []);
  const maxLen = Math.max(0, ...arrays.map(a=>a.length));
  const out = [];
  for (let i=0;i<maxLen;i++) for (let j=0;j<arrays.length;j++) if (i < arrays[j].length) out.push(arrays[j][i]);
  return out;
}
function rrMergeAppend(orderKeys, perSiteNewArrays, startIndex) {
  const arrays = orderKeys.map((k)=> perSiteNewArrays.get(k) || []);
  const total = arrays.reduce((s,a)=>s+a.length, 0);
  const out = [];
  if (arrays.length === 0 || total === 0) return out;
  let remaining = total;
  while (remaining > 0) {
    for (let j=0; j<arrays.length; j++) {
      const idx = (startIndex + j) % arrays.length;
      const a = arrays[idx];
      if (a.length) { out.push(a.shift()); remaining--; }
    }
  }
  return out;
}

// ---------- filename templating ----------
function sanitizeName(s) {
  return String(s || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}
function getUrlMeta(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').pop() || '');
    const original = last || 'image';
    const ext = (original.includes('.') ? original.split('.').pop() : 'jpg').toLowerCase().slice(0, 10);
    return { original, ext };
  } catch {
    return { original: 'image', ext: 'jpg' };
  }
}
function formatDateParts(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return { y:'', m:'', d:'', hhmm:'' , yyyy_mm_dd: '' };
  const y = String(d.getFullYear());
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  return { y, m, d: dd, hhmm: `${hh}${mm}`, yyyy_mm_dd: `${y}-${m}-${dd}` };
}
function extractTagCategory(post, key) {
  const src = post?.[key] ?? post?.meta?.[key] ?? null;
  if (Array.isArray(src)) return src.join('_');
  if (typeof src === 'string') return src.split(/[,\s]+/).filter(Boolean).join('_');
  return '';
}
function buildFileNameFromTemplate(post, index, template) {
  const url = post?.file_url || post?.sample_url || post?.preview_url || '';
  const { original, ext } = getUrlMeta(url);
  const site = post?.site?.name || post?.site?.type || 'site';
  const site_type = post?.site?.type || '';
  const id = post?.id ?? '';
  const score = safeNum(post?.score, '');
  const favorites = safeNum(post?.favorites, '');
  const rating = post?.rating || '';
  const width = safeNum(post?.width, '');
  const height = safeNum(post?.height, '');
  const idx = (Number(index) + 1) || 1;

  const dp = formatDateParts(post?.created_at);
  const created = dp.yyyy_mm_dd;

  const artist = extractTagCategory(post, 'artist');
  const copyright = extractTagCategory(post, 'copyright');
  const character = extractTagCategory(post, 'character');

  const map = {
    site, site_type, id, score, favorites, rating, width, height,
    index: String(idx), ext, original_name: original,
    created, created_yyyy: dp.y, created_mm: dp.m, created_dd: dp.d, created_hhmm: dp.hhmm,
    artist, copyright, character
  };

  let name = String(template || '{site}-{id}');
  name = name.replace(/\{([a-z0-9_]+)\}/ig, (_, k) => sanitizeName(map[k] ?? ''));

  name = name.replace(/(\s*[-_,]\s*){2,}/g, '$1')
             .replace(/^[,._ -]+|[,._ -]+$/g, '')
             .replace(/\s{2,}/g, ' ')
             .trim();

  if (!name.toLowerCase().endsWith(`.${ext}`)) name = `${name}.${ext}`;
  return sanitizeName(name).replace(/[\/\\]/g, '_');
}

window.getFileNameForPost = (post, index=0) =>
  buildFileNameFromTemplate(post, index, state.nameTemplate || '{site}-{id}');

// ---------- render helpers ----------
function updateFeedHeader() {
  const title = document.getElementById('view-title');
  const description = document.getElementById('view-description');
  const count = document.getElementById('result-count');
  const refresh = document.getElementById('btn-refresh-feed');
  if (!title || !description || !count) return;

  const sourceCount = enabledSites().length;
  const copy = {
    new: ['New', `Latest posts across ${sourceCount || 'your'} enabled source${sourceCount === 1 ? '' : 's'}`],
    popular: ['Popular', 'High-scoring posts from across your sources'],
    search: ['Search', state.search ? `Results for “${state.search}”` : 'Gelbooru syntax is translated for compatible sources'],
    faves: ['Favourites', 'Everything you have saved, in one place']
  }[state.viewType] || ['Browse', 'Explore your configured sources'];

  title.textContent = copy[0];
  description.textContent = copy[1];
  const total = state.items.length;
  count.textContent = `${total.toLocaleString()} post${total === 1 ? '' : 's'}${state.loading ? ' · Updating…' : ''}`;
  if (refresh) {
    refresh.disabled = state.loading;
    refresh.setAttribute('aria-busy', String(state.loading));
  }
}

function ensureScrollSentinel() {
  const feed = document.getElementById('feed');
  if (!feed) return null;
  let s = document.getElementById('scroll-sentinel');
  if (!s) {
    s = document.createElement('div');
    s.id = 'scroll-sentinel';
    s.style.width = '1px';
    s.style.height = '1px';
    s.style.gridColumn = '1 / -1';
  }
  if (s.parentNode !== feed) feed.appendChild(s);
  else if (feed.lastElementChild !== s) feed.appendChild(s);
  return s;
}
function observeSentinel() {
  try {
    if (!state._io) return;
    const s = ensureScrollSentinel();
    if (s) state._io.observe(s);
  } catch {}
}

// ---------- skeletons + empty states ----------
function showSkeletons(count = 12) {
  const feed = document.getElementById('feed');
  if (!feed || feed.querySelector(':scope > .card') || feed.querySelector(':scope > .card-skeleton')) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const sk = document.createElement('div');
    sk.className = 'card-skeleton';
    sk.setAttribute('aria-hidden', 'true');
    const thumb = document.createElement('div');
    thumb.className = 'sk-thumb';
    const bar = document.createElement('div');
    bar.className = 'sk-bar';
    sk.appendChild(thumb);
    sk.appendChild(bar);
    frag.appendChild(sk);
  }
  feed.appendChild(frag);
  ensureScrollSentinel();
}
function clearSkeletons() {
  document.querySelectorAll('#feed > .card-skeleton').forEach((el) => el.remove());
}
function clearFeedEmptyState() {
  document.getElementById('feed-empty')?.remove();
}
function renderFeedEmptyState(kind) {
  clearSkeletons();
  clearFeedEmptyState();
  document.getElementById('loading')?.classList.add('hidden');
  const feed = document.getElementById('feed');
  if (!feed) return;

  const box = document.createElement('div');
  box.id = 'feed-empty';
  box.className = 'empty-state';

  const art = document.createElement('div');
  art.className = 'empty-art';
  const title = document.createElement('h3');
  const text = document.createElement('p');
  const actions = document.createElement('div');
  actions.className = 'empty-actions';

  const button = (label, onClick, accent = false) => {
    const b = document.createElement('button');
    b.className = accent ? 'link-btn accent' : 'link-btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };

  if (kind === 'no-sites') {
    art.textContent = '🌊';
    title.textContent = 'Welcome to StreamBooru';
    text.textContent = 'Add at least one booru source to start browsing. Presets are available for Danbooru, Gelbooru, Yande.re, e621 and more.';
    actions.appendChild(button('Open Manage Sites', () => document.getElementById('btn-manage-sites')?.click(), true));
  } else if (kind === 'all-disabled') {
    art.textContent = '🌫';
    title.textContent = 'All sources are disabled';
    text.textContent = 'Re-enable a source below the feed header, or manage the full list in Sites.';
    actions.appendChild(button('Open Manage Sites', () => document.getElementById('btn-manage-sites')?.click(), true));
  } else if (kind === 'no-results') {
    art.textContent = '🔍';
    title.textContent = state.search ? `No results for “${state.search}”` : 'No results';
    text.textContent = 'Check the tag spelling, loosen the rating filter in Manage Sites, or try fewer tags.';
    if (state.search) actions.appendChild(button('Clear search', () => document.getElementById('tag-clear-btn')?.click()));
  } else if (kind === 'no-faves') {
    art.textContent = '♥';
    if (state.search) {
      title.textContent = 'No favourites match your filter';
      text.textContent = 'Try different tags, or clear the filter to see everything you saved.';
      actions.appendChild(button('Clear filter', () => document.getElementById('tag-clear-btn')?.click()));
    } else {
      title.textContent = 'No favourites yet';
      text.textContent = 'Press Fave on any post to keep it here. Log in from Account to sync favourites across devices.';
      actions.appendChild(button('Browse new posts', () => document.getElementById('tab-new')?.click(), true));
    }
  }

  box.appendChild(art);
  box.appendChild(title);
  box.appendChild(text);
  if (actions.children.length) box.appendChild(actions);
  feed.appendChild(box);
}

// ---------- StreamBooru community fave counts ----------
const sbFaveCounts = new Map();     // itemKey -> count
const sbFaveRequested = new Set();  // keys already queried this session
const sbFaveQueue = new Set();
let sbFaveTimer = null;
let sbFaveBackoffUntil = 0;         // pause queries while the sync server is unreachable

window.getSbFaveCount = (post) => {
  const n = sbFaveCounts.get(itemKey(post));
  return Number.isFinite(n) ? n : null;
};

function applySbFaveCount(key) {
  const card = cardCache.get(key);
  const el = card?.querySelector?.('.sb-favs');
  if (!el) return;
  const n = sbFaveCounts.get(key) || 0;
  if (n > 0) {
    el.textContent = `♥ ${n}`;
    el.title = `${n} StreamBooru user${n === 1 ? '' : 's'} faved this`;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

function flushSbFaveQueue() {
  if (sbFaveTimer || sbFaveQueue.size === 0) return;
  if (Date.now() < sbFaveBackoffUntil) return;
  sbFaveTimer = setTimeout(async () => {
    sbFaveTimer = null;
    const batch = [...sbFaveQueue].slice(0, 200);
    batch.forEach((k) => sbFaveQueue.delete(k));
    const fail = () => {
      // Allow a retry later, but stop asking a dead server on every batch
      batch.forEach((k) => sbFaveRequested.delete(k));
      sbFaveBackoffUntil = Date.now() + 60_000;
    };
    try {
      const res = await window.api.favCounts(batch);
      if (res?.ok) {
        for (const k of batch) sbFaveCounts.set(k, Number(res.counts?.[k]) || 0);
        batch.forEach(applySbFaveCount);
      } else {
        fail();
      }
    } catch {
      fail();
    }
    flushSbFaveQueue();
  }, 250);
}

function queueSbFaveCounts(keys) {
  if (typeof window.api?.favCounts !== 'function') return;
  for (const k of keys) {
    if (sbFaveRequested.has(k)) continue;
    sbFaveRequested.add(k);
    sbFaveQueue.add(k);
  }
  flushSbFaveQueue();
}

// Re-query one post's count after a fave toggle syncs
function refreshSbFaveCount(post) {
  const key = itemKey(post);
  sbFaveRequested.delete(key);
  queueSbFaveCounts([key]);
}

// ---------- keyed feed rendering ----------
const cardCache = new Map(); // itemKey -> card element

function getCardFor(post, index) {
  const key = itemKey(post);
  let el = cardCache.get(key);
  if (!el) {
    el = window.PostCard(post, index);
    cardCache.set(key, el);
  }
  return el;
}

// Reconcile #feed with state.items, reusing card nodes so re-sorts don't
// re-decode images or restart playing video thumbs
function syncFeedChildren() {
  const feed = document.getElementById('feed');
  if (!feed) return;
  clearSkeletons();
  if (state.items.length > 0) clearFeedEmptyState();

  const sentinel = ensureScrollSentinel();
  const desired = state.items.map((p, i) => getCardFor(p, i));
  const desiredSet = new Set(desired);

  for (const child of [...feed.children]) {
    if (child === sentinel || child.id === 'feed-empty') continue;
    if (!desiredSet.has(child)) child.remove();
  }
  for (let i = 0; i < desired.length; i++) {
    const node = desired[i];
    if (feed.children[i] !== node) feed.insertBefore(node, feed.children[i] || null);
  }
  // Prune cached cards that belong to other views once the cache gets large
  if (cardCache.size > desired.length + 400) {
    const keep = new Set(state.items.map(itemKey));
    for (const [key, el] of cardCache) {
      if (!keep.has(key) && !el.isConnected) cardCache.delete(key);
    }
  }
  ensureScrollSentinel();
  observeSentinel();
  updateFeedHeader();
  relayoutNaturalGrid();
  queueSbFaveCounts(state.items.map(itemKey));
}

function renderAppend() {
  syncFeedChildren();
}
function renderReplacePreserveScroll() {
  const feed = document.getElementById('feed');
  const topbarH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 64;
  let anchorKey = null, anchorTop = null;
  for (const child of Array.from(feed.children)) {
    if (!child.classList?.contains('card')) continue;
    const rect = child.getBoundingClientRect();
    if (rect.bottom > topbarH) { anchorKey = child.dataset?.key || null; anchorTop = rect.top; break; }
  }
  syncFeedChildren();
  if (anchorKey) {
    const newAnchor = feed.querySelector(`[data-key="${CSS.escape(anchorKey)}"]`);
    if (newAnchor && typeof anchorTop === 'number') {
      const rect2 = newAnchor.getBoundingClientRect();
      window.scrollBy(0, rect2.top - anchorTop);
    }
  }
}
function renderReplaceNoPreserve() {
  syncFeedChildren();
}
window.getGalleryItems = () => state.items;

// ---------- natural-aspect grid layout ----------
let naturalLayoutPending = false;
let naturalLayoutApplied = false;
function relayoutNaturalGrid() {
  if (naturalLayoutPending) return;
  // no-op in square-crop mode unless there are leftover spans to clear
  if (document.body.dataset.fit !== 'natural' && !naturalLayoutApplied) return;
  naturalLayoutPending = true;
  requestAnimationFrame(() => {
    naturalLayoutPending = false;
    const feed = document.getElementById('feed');
    if (!feed) return;
    const cards = feed.querySelectorAll(':scope > .card');
    if (document.body.dataset.fit !== 'natural') {
      cards.forEach((el) => { if (el.style.gridRowEnd) el.style.gridRowEnd = ''; });
      naturalLayoutApplied = false;
      return;
    }
    if (!cards.length) return;
    naturalLayoutApplied = true;
    const rowUnit = 8;
    // Read all layout up front (actions height is effectively constant), then
    // write every span — no read/write interleaving means one reflow, not N.
    const gap = parseFloat(getComputedStyle(feed).rowGap) || 12;
    const width = cards[0].getBoundingClientRect().width;
    if (!width) return;
    const actionsH = cards[0].querySelector('.actions')?.offsetHeight || 52;
    const spans = new Array(cards.length);
    for (let i = 0; i < cards.length; i++) {
      const ar = Number(cards[i].dataset.ar) || 1;
      const total = (width / ar) + actionsH + 2;
      spans[i] = Math.max(1, Math.ceil((total + gap) / (rowUnit + gap)));
    }
    for (let i = 0; i < cards.length; i++) {
      const value = `span ${spans[i]}`;
      if (cards[i].style.gridRowEnd !== value) cards[i].style.gridRowEnd = value;
    }
  });
}
window.addEventListener('resize', () => relayoutNaturalGrid());

// --------- caching current view (for instant tab switching) ----------
const VIEW_CACHE_TTL_MS = {
  new: 2 * 60 * 1000,     // 2 min — backup expiry; manual refresh clears sooner
  popular: 30 * 1000,     // 30 sec — popular shifts faster
  search: 3 * 60 * 1000   // 3 min — explicit query, less volatile
};

function viewCacheTtl(viewType) {
  return VIEW_CACHE_TTL_MS[viewType] ?? 0;
}

function invalidateViewCache(viewType) {
  const c = state.viewCache[viewType];
  if (!c) return;
  c.items = [];
  c.cursors = {};
  c.search = '';
  c.cachedAt = 0;
  c.stale = true;
  c.endedSites = new Set();
  c.noMoreResults = false;
  if (viewType === 'new') {
    c.feedSeen = new Set();
    c.rrCursor = 0;
  }
  if (viewType === 'search') {
    c.searchBuckets = new Map();
    c.searchSeen = new Set();
  }
}

function isViewCacheFresh(viewType) {
  const c = state.viewCache[viewType];
  if (!c?.items?.length || c.stale) return false;
  if (!c.cachedAt) return false;
  const ttl = viewCacheTtl(viewType);
  if (ttl <= 0) return true;
  return (Date.now() - c.cachedAt) < ttl;
}

function refreshView(viewType) {
  invalidateViewCache(viewType);
  if (state.viewType !== viewType) return;
  clearFeed();
  scrollToTop();
  fetchBatch();
}

function saveViewCache() {
  const v = state.viewType;
  const c = state.viewCache[v];
  if (!c) return;
  c.items = [...state.items];
  c.cursors = { ...state.cursors };
  c.search = state.search;
  c.endedSites = new Set(state.endedSites);
  c.noMoreResults = state.noMoreResults;
  c.cachedAt = Date.now();
  c.stale = false;
  if (v === 'new') {
    c.feedSeen = new Set(state.feedSeen);
    c.rrCursor = state.rrCursor;
  }
  if (v === 'search') {
    c.searchBuckets = new Map(state.searchBuckets);
    c.searchSeen = new Set(state.searchSeen);
  }
}
function restoreViewCache({ preserveScroll = true } = {}) {
  const v = state.viewType;
  const c = state.viewCache[v];
  if (!c) return false;
  if (!isViewCacheFresh(v)) {
    invalidateViewCache(v);
    return false;
  }
  state.items = [...(c.items || [])];
  state.cursors = { ...(c.cursors || {}) };
  state.search = c.search || '';
  state.endedSites = new Set(c.endedSites || []);
  state.noMoreResults = !!c.noMoreResults;
  if (v === 'new') {
    state.feedSeen = new Set(c.feedSeen || []);
    state.rrCursor = c.rrCursor || 0;
  }
  if (v === 'search') {
    state.searchBuckets = new Map(c.searchBuckets || []);
    state.searchSeen = new Set(c.searchSeen || []);
  }
  if (state.items.length) {
    if (preserveScroll) {
      renderReplacePreserveScroll();
    } else {
      renderReplaceNoPreserve();
      scrollToTop();
    }
    document.getElementById('loading').classList.add('hidden');
    return true;
  }
  return false;
}

// ---------- fetching ----------
function updateCursorAndEnd(key, res, prevCursor) {
  if (res && Object.prototype.hasOwnProperty.call(res, 'nextCursor')) {
    state.cursors[key] = res.nextCursor;
    if (res.nextCursor === null) state.endedSites.add(key);
  } else {
    state.cursors[key] = prevCursor ?? null;
  }
}

function allSitesEnded() {
  const total = state.searchOrder.length;
  if (total === 0) return false;
  return state.searchOrder.every((k) => state.endedSites.has(k));
}

async function fetchBatch() {
  const loadingEl = document.getElementById('loading');
  if (state.noMoreResults) {
    if (state.items.length === 0) {
      renderFeedEmptyState(state.viewType === 'faves' ? 'no-faves' : 'no-results');
    } else {
      loadingEl.classList.remove('hidden'); loadingEl.textContent = 'End of results';
    }
    return;
  }
  if (state.loading) { state.pendingFetch = true; return; }

  const gen = state.fetchGen;
  state.loading = true; loadingEl.classList.remove('hidden'); loadingEl.textContent = 'Loading…';
  updateFeedHeader();

  if (state.viewType === 'faves') {
    const all = await window.api.getLocalFavorites();
    const filtered = (all || []).filter((p)=> tagsInclude(p, state.search));
    state.items = sortItems(filtered, 'faves');
    renderReplaceNoPreserve();
    scrollToTop();
    loadingEl.classList.add('hidden');
    if (state.items.length === 0) renderFeedEmptyState('no-faves');
    state.loading = false;
    updateFeedHeader();
    saveViewCache();
    if (state.pendingFetch) { state.pendingFetch = false; fetchBatch(); }
    return;
  }

  const sites = enabledSites();
  if (sites.length === 0) {
    renderFeedEmptyState(configuredSites().length === 0 ? 'no-sites' : 'all-disabled');
    state.loading = false;
    updateFeedHeader();
    return;
  }

  const doSearch = state.viewType === 'search' && (state.search || '').trim().length > 0;
  const isPopular = state.viewType === 'popular';
  const isNew = state.viewType === 'new';

  if (isPopular) {
    await fetchPopularStreaming(sites, gen);
    return;
  }

  const reqs = sites.map(async (site)=>{
    const s2 = { ...site, baseUrl: normalizeBaseUrl(site.baseUrl) };
    const key = siteKey(s2);
    const cursor = state.cursors[key] ?? 1;
    const res = await window.api.fetchBooru({
      site: s2,
      viewType: doSearch ? 'new' : state.viewType,
      cursor,
      limit: 40,
      search: state.search || ''
    });
    updateCursorAndEnd(key, res, cursor);
    return { key, posts: Array.isArray(res?.posts) ? res.posts : [] };
  });

  let results; try { results = await Promise.allSettled(reqs); } catch { results = []; }
  if (gen !== state.fetchGen) { state.loading = false; updateFeedHeader(); if (state.pendingFetch) { state.pendingFetch = false; fetchBatch(); } return; }

  let addedTotal = 0;

  if (doSearch) {
    if (state.orderLock) {
      const perSiteNew = new Map(); for (const k of state.searchOrder) perSiteNew.set(k, []);
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const { key, posts } = r.value;
        if (!perSiteNew.has(key)) perSiteNew.set(key, []);
        const arr = perSiteNew.get(key);
        for (const p of posts) {
          const k = itemKey(p);
          if (state.searchSeen.has(k)) continue;
          state.searchSeen.add(k);
          arr.push(p);
        }
      }
      const chunk = rrMergeAppend(state.searchOrder, perSiteNew, 0);
      if (chunk.length > 0) {
        const before = state.items.length;
        state.items = state.items.concat(chunk);
        addedTotal = state.items.length - before;
        if (addedTotal > 0) renderAppend();
      }
    } else {
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const { key, posts } = r.value;
        if (!state.searchBuckets.has(key)) state.searchBuckets.set(key, []);
        const bucket = state.searchBuckets.get(key);
        for (const p of posts) {
          const k = itemKey(p);
          if (state.searchSeen.has(k)) continue;
          state.searchSeen.add(k);
          bucket.push(p);
        }
      }
      const before = state.items.length;
      state.items = interleaveRoundRobin(state.searchOrder, state.searchBuckets);
      addedTotal = Math.max(0, state.items.length - before);
      if (addedTotal > 0) renderAppend();
    }
  } else if (isNew) {
    const perSiteNew = new Map(); for (const k of state.searchOrder) perSiteNew.set(k, []);
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const { key, posts } = r.value;
      if (!perSiteNew.has(key)) perSiteNew.set(key, []);
      const arr = perSiteNew.get(key);
      for (const p of posts) { const k = itemKey(p); if (state.feedSeen.has(k)) continue; state.feedSeen.add(k); arr.push(p); }
    }
    const chunk = rrMergeAppend(state.searchOrder, perSiteNew, state.rrCursor);
    addedTotal = chunk.length;
    if (addedTotal > 0) {
      state.items = state.items.concat(chunk);
      renderAppend();
      const siteCount = Math.max(1, state.searchOrder.length);
      state.rrCursor = (state.rrCursor + 1) % siteCount;
    }
  }

  if (addedTotal === 0 && allSitesEnded()) {
    state.noMoreResults = true;
    if (state.items.length === 0) {
      renderFeedEmptyState('no-results');
    } else {
      loadingEl.classList.remove('hidden'); loadingEl.textContent = 'End of results';
    }
  } else {
    loadingEl.classList.add('hidden');
  }

  state.loading = false;
  updateFeedHeader();
  saveViewCache();
  if (state.pendingFetch) { const runAgain = !state.noMoreResults; state.pendingFetch = false; if (runAgain) fetchBatch(); }
}

// Popular streaming fetch: render per-site as they arrive, but avoid reordering above user
async function fetchPopularStreaming(sites, gen) {
  if (!Array.isArray(state.searchOrder) || state.searchOrder.length === 0) {
    state.searchOrder = enabledSites().map((s)=> siteKey(s));
  }

  let pending = sites.length;
  const seen = new Set(state.items.map(itemKey));

  for (const site of sites) {
    const s2 = { ...site, baseUrl: normalizeBaseUrl(site.baseUrl) };
    const key = siteKey(s2);
    const cursor = state.cursors[key] ?? 1;

    window.api.fetchBooru({
      site: s2,
      viewType: state.viewType,
      cursor,
      limit: 40,
      search: state.search || ''
    }).then((res)=>{
      if (gen !== state.fetchGen) return;
      updateCursorAndEnd(key, res, cursor);

      const newbies = (res?.posts || []).filter((p) => {
        const k = itemKey(p);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      if (newbies.length === 0) return;

      if (!state.orderLock && atTop() && !anyMediaActive()) {
        const merged = state.items.concat(newbies);
        const pop = computePopularity(merged);
        merged.sort((a,b)=>popularCompare(a,b,pop));
        state.items = merged;
        renderReplacePreserveScroll();
      } else {
        const popNew = computePopularity(newbies);
        const sortedNewbies = newbies.slice().sort((a,b)=>popularCompare(a,b,popNew));
        const before = state.items.length;
        state.items = state.items.concat(sortedNewbies);
        if (state.items.length > before) renderAppend();
      }
    }).catch(()=>{}).finally(()=>{
      pending--;
      if (pending !== 0) return;
      // This batch still owns state.loading once its generation goes stale: whatever
      // superseded it found the flag set and only queued itself. Dropping out here would
      // leave nothing to clear it, and every route back — scrolling, refresh — is gated
      // on that same flag, so the feed sits on "Loading…" for good.
      if (gen !== state.fetchGen) {
        state.loading = false;
        updateFeedHeader();
        if (state.pendingFetch) { state.pendingFetch = false; fetchBatch(); }
        else document.getElementById('loading').classList.add('hidden');
        return;
      }
      if (allSitesEnded() && state.items.length === 0) {
        renderFeedEmptyState('no-results');
        state.noMoreResults = true;
      } else {
        document.getElementById('loading').classList.add('hidden');
      }
      state.loading = false;
      updateFeedHeader();
      saveViewCache();
      if (state.pendingFetch) { state.pendingFetch = false; fetchBatch(); }
    });
  }
}

// ---------- Download All + Options popover ----------
function sanitizeForFolder(s) { return String(s || '').replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').slice(0, 200); }
function toDownloadItem(post, i) {
  const url = post?.file_url || post?.sample_url || post?.preview_url || '';
  if (!url) return null;
  const siteName = post?.site?.name || post?.site?.baseUrl || 'unknown';
  const fileName = buildFileNameFromTemplate(post, i, state.nameTemplate || '{site}-{id}');
  return { url, siteName: sanitizeForFolder(siteName), fileName };
}

// ----- bulk progress panel -----
const bulkUi = { visible: false, hideTimer: null };
function bulkProgressEls() {
  return {
    panel: document.getElementById('bulk-progress'),
    label: document.getElementById('bulk-progress-label'),
    count: document.getElementById('bulk-progress-count'),
    bar: document.getElementById('bulk-progress-bar'),
    cancel: document.getElementById('bulk-progress-cancel')
  };
}
function showBulkProgress() {
  const { panel, label, count, bar, cancel } = bulkProgressEls();
  if (!panel) return;
  clearTimeout(bulkUi.hideTimer);
  bulkUi.visible = true;
  label.textContent = 'Downloading…';
  count.textContent = '';
  bar.style.width = '0%';
  cancel.disabled = false;
  panel.classList.remove('hidden');
}
function updateBulkProgress(p) {
  if (!p || !bulkUi.visible) return;
  const { label, count, bar } = bulkProgressEls();
  if (!label) return;
  const total = Math.max(1, safeNum(p.total, 1));
  const done = Math.min(safeNum(p.done, 0), total);
  bar.style.width = `${Math.round((done / total) * 100)}%`;
  count.textContent = `${done} / ${total}${p.failed ? ` · ${p.failed} failed` : ''}`;
  label.textContent = p.cancelled ? 'Cancelling…' : 'Downloading…';
}
function hideBulkProgress(delay = 600) {
  clearTimeout(bulkUi.hideTimer);
  bulkUi.hideTimer = setTimeout(() => {
    bulkUi.visible = false;
    bulkProgressEls().panel?.classList.add('hidden');
  }, delay);
}

async function onDownloadAllClick() {
  try {
    if (!window.api?.downloadBulk) { notifyError('Bulk download is not available in this build.'); return; }
    const posts = Array.isArray(state.items) ? state.items : [];
    if (posts.length === 0) { notify('No results to download.'); return; }
    const items = posts.map(toDownloadItem).filter(Boolean);
    if (items.length === 0) { notify('No downloadable URLs found in the current results.'); return; }
    showBulkProgress();
    const res = await window.api.downloadBulk(items, { subfolderBySite: true, concurrency: 3 });
    hideBulkProgress();
    if (res?.cancelled && !res?.ok) return; // folder dialog dismissed
    if (!res?.ok) { notifyError(`Download failed: ${res?.error || 'unknown error'}`); return; }
    const failedCount = (res.failed || []).length;
    const where = res.basePath ? ` → ${res.basePath}` : '';
    if (res.cancelled) {
      notify(`Download cancelled — saved ${res.saved} of ${items.length}${where}`);
    } else if (failedCount) {
      notify(`Saved ${res.saved} file(s), ${failedCount} failed${where}`, { type: 'error' });
    } else {
      notify(`Saved ${res.saved} file(s)${where}`, { type: 'success' });
    }
  } catch (e) {
    hideBulkProgress(0);
    console.error('Download all error:', e);
    notifyError(`Download error: ${e?.message || e}`);
  }
}

function setNameTemplate(value) {
  const v = String(value || '').trim();
  state.nameTemplate = v || null;
  saveConfigPatch({ nameTemplate: state.nameTemplate || '' });
}

function syncTemplateControls() {
  const select = document.getElementById('name-template');
  const customRow = document.getElementById('custom-template-row');
  const customInput = document.getElementById('custom-template');
  if (!select || !customRow || !customInput) return;
  const current = state.nameTemplate || '{site}-{id}';
  const preset = [...select.options].find((o) => o.value === current);
  if (preset) {
    select.value = current;
    customRow.classList.add('hidden');
  } else {
    select.value = '__custom__';
    customRow.classList.remove('hidden');
    customInput.value = current;
  }
}

function openDownloadOptionsPopover(anchorEl) {
  const pop = document.getElementById('download-options');
  if (!pop) return;

  syncTemplateControls();

  const rect = anchorEl.getBoundingClientRect();
  const margin = 8;
  pop.classList.remove('hidden');
  pop.style.visibility = 'hidden';
  pop.style.left = '0px'; pop.style.top = '0px';
  const pw = pop.offsetWidth || 360;
  const ph = pop.offsetHeight || 120;
  pop.style.visibility = '';

  let left = Math.max(8, Math.min(window.innerWidth - pw - 8, rect.right - pw));
  let top = Math.max(8, Math.min(window.innerHeight - ph - 8, rect.bottom + margin));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;

  let releaseOverlay = null;
  const close = () => {
    pop.classList.add('hidden');
    document.removeEventListener('mousedown', outside);
    window.removeEventListener('keydown', esc);
    releaseOverlay?.();
    releaseOverlay = null;
  };
  const outside = (e) => { if (!pop.contains(e.target) && e.target !== anchorEl) close(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('mousedown', outside);
  window.addEventListener('keydown', esc);
  releaseOverlay = window.SBOverlay?.open?.('download-options', { close, root: pop, lockScroll: false });

  const btnClose = document.getElementById('dlopt-close');
  if (btnClose) { btnClose.onclick = close; }
}

function setupDownloadAll() {
  const btnAll = document.getElementById('btn-download-all');
  if (btnAll) {
    btnAll.addEventListener('click', (e) => {
      if (e.shiftKey || e.altKey) { openDownloadOptionsPopover(btnAll); return; }
      onDownloadAllClick();
    });
    btnAll.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openDownloadOptionsPopover(btnAll);
    });
  }

  const select = document.getElementById('name-template');
  const customRow = document.getElementById('custom-template-row');
  const customInput = document.getElementById('custom-template');
  if (select && customRow && customInput) {
    select.addEventListener('change', () => {
      if (select.value === '__custom__') {
        customRow.classList.remove('hidden');
        customInput.value = state.nameTemplate && ![...select.options].some((o) => o.value === state.nameTemplate)
          ? state.nameTemplate
          : (customInput.value || '');
        customInput.focus();
        if (customInput.value.trim()) setNameTemplate(customInput.value);
      } else {
        customRow.classList.add('hidden');
        setNameTemplate(select.value);
      }
    });
    let customTimer = null;
    customInput.addEventListener('input', () => {
      clearTimeout(customTimer);
      customTimer = setTimeout(() => setNameTemplate(customInput.value), 400);
    });
    customInput.addEventListener('change', () => setNameTemplate(customInput.value));
  }

  const cancelBtn = document.getElementById('bulk-progress-cancel');
  cancelBtn?.addEventListener('click', async () => {
    cancelBtn.disabled = true;
    try { await window.api.downloadBulkCancel?.(); } catch {}
  });
  window.events?.onDownloadProgress?.((p) => updateBulkProgress(p));
}

// ---------- Tabs/Search/Manage/Scroll ----------
function switchToView(viewType, { force = false } = {}) {
  if (state.viewType === viewType && !force) {
    if (viewType === 'new' || viewType === 'popular') refreshView(viewType);
    return;
  }
  saveViewCache();
  state.viewType = viewType;
  setActiveTab();
  if (!restoreViewCache({ preserveScroll: false })) { clearFeed(); scrollToTop(); fetchBatch(); }
  else { scrollToTop(); }
}

function setupTabs() {
  document.getElementById('tab-new').addEventListener('click', ()=> switchToView('new'));
  document.getElementById('tab-popular').addEventListener('click', ()=> switchToView('popular'));
  document.getElementById('tab-search').addEventListener('click', ()=> { if (state.viewType !== 'search') switchToView('search'); });
  document.getElementById('tab-faves').addEventListener('click', ()=> { if (state.viewType !== 'faves') switchToView('faves'); });
}
function setActiveTab() {
  document.querySelectorAll('.tab').forEach((t)=>{
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  const btn = document.querySelector(`[data-view="${state.viewType}"]`);
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
  }
  updateFeedHeader();
}
async function loadConfig() {
  state.config = (await window.api.loadConfig()) || { sites: [] };
  state.nameTemplate = typeof state.config.nameTemplate === 'string' && state.config.nameTemplate.trim()
    ? state.config.nameTemplate.trim()
    : null;
  state.settings = { ...DEFAULT_SETTINGS, ...(state.config.settings || {}) };
  state.searchOrder = enabledSites().map((s)=>siteKey(s));
  applySettings();
}
function clearFeed() {
  invalidateViewCache(state.viewType);
  state.items = [];
  state.cursors = {};
  state.searchBuckets = new Map();
  state.searchSeen = new Set();
  state.feedSeen = new Set();
  state.rrCursor = 0;
  state.endedSites = new Set();
  state.noMoreResults = false;
  state.pendingFetch = false;
  state.fetchGen++;
  state.orderLock = false;
  cardCache.clear();
  const feed = document.getElementById('feed');
  feed.innerHTML = '';
  clearFeedEmptyState();
  showSkeletons();
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('loading').textContent = 'Loading…';
  ensureScrollSentinel(); observeSentinel();
}

// ---------- source chips ----------
function renderSourceChips() {
  const wrap = document.getElementById('source-chips');
  if (!wrap) return;
  const sites = configuredSites();
  wrap.innerHTML = '';
  if (sites.length < 2) { wrap.hidden = true; return; }
  wrap.hidden = false;

  sites.forEach((site) => {
    const enabled = site.enabled !== false;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'source-chip';
    chip.setAttribute('aria-pressed', String(enabled));
    chip.title = enabled ? `Disable ${site.name || site.baseUrl}` : `Enable ${site.name || site.baseUrl}`;
    const dot = document.createElement('span');
    dot.className = 'chip-dot';
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(site.name || site.baseUrl));
    chip.addEventListener('click', async () => {
      site.enabled = !enabled ? true : false;
      state.searchOrder = enabledSites().map(siteKey);
      renderSourceChips();
      await saveConfigPatch({ sites: state.config.sites });
      try {
        const acct = await window.api.accountGet?.();
        if (acct?.loggedIn) await window.api.sitesSaveRemote(state.config.sites || []);
      } catch {}
      for (const k of Object.keys(state.viewCache)) invalidateViewCache(k);
      if (state.viewType !== 'faves') { clearFeed(); scrollToTop(); fetchBatch(); }
      else updateFeedHeader();
    });
    wrap.appendChild(chip);
  });
}

// ---------- search + autocomplete ----------
function runSearch(query) {
  const input = document.getElementById('tag-search');
  if (input) input.value = query;
  state.search = (query || '').trim();
  state.viewType = 'search';
  setActiveTab();
  clearFeed();
  scrollToTop();
  fetchBatch();
}
window.searchForTag = (tag) => {
  const t = String(tag || '').trim();
  if (!t) return;
  runSearch(t);
};

function setupSearch() {
  const form = document.getElementById('search-form');
  const input = document.getElementById('tag-search');
  const btnClear = document.getElementById('tag-clear-btn');
  if (state.search) input.value = state.search;
  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    runSearch(input.value || '');
  });
  btnClear.addEventListener('click', ()=>{
    if (!input.value && !state.search) return;
    input.value = '';
    state.search = '';
    if (state.viewType === 'search') state.viewType = 'new';
    setActiveTab();
    clearFeed();
    scrollToTop();
    fetchBatch();
  });
  attachTagAutocomplete(input, document.getElementById('tag-suggest'), {
    onPick: () => {}
  });
  const menuInput = document.getElementById('mnu-tag-search');
  if (menuInput) attachTagAutocomplete(menuInput, null, { onPick: () => {} });
}

const AUTOCOMPLETE_CATEGORY_CLASS = {
  '1': 'artist',
  '3': 'copyright',
  '4': 'character',
  '5': 'meta',
  'artist': 'artist',
  'copyright': 'copyright',
  'character': 'character',
  'meta': 'meta'
};

function attachTagAutocomplete(input, listbox, { onPick } = {}) {
  if (!input || typeof window.api?.autocomplete !== 'function') return;

  let box = listbox;
  if (!box) {
    box = document.createElement('div');
    box.className = 'suggest hidden';
    box.setAttribute('role', 'listbox');
    const parent = input.closest('form') || input.parentElement;
    if (!parent) return;
    parent.classList.add('has-suggest');
    parent.appendChild(box);
  }

  let debounceTimer = null;
  let requestSeq = 0;
  let activeIndex = -1;
  let current = [];

  const close = () => {
    box.classList.add('hidden');
    box.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    activeIndex = -1;
    current = [];
  };

  const currentToken = () => {
    const caret = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, caret);
    const m = before.match(/(^|\s)(-?)([^\s]+)$/);
    if (!m) return null;
    const raw = m[3];
    if (!raw || raw.length < 2) return null;
    if (/^rating:/i.test(raw) || /^(order|sort|score|id|date|width|height|filter_id):/i.test(raw)) return null;
    return { token: raw, negated: m[2] === '-', start: caret - raw.length, end: caret };
  };

  const applySuggestion = (sug) => {
    const tok = currentToken();
    const value = sug.value;
    if (!tok) {
      input.value = `${input.value.trim()} ${value} `.trimStart();
    } else {
      input.value = `${input.value.slice(0, tok.start)}${value} ${input.value.slice(tok.end).trimStart()}`;
      const pos = tok.start + value.length + 1;
      try { input.setSelectionRange(pos, pos); } catch {}
    }
    close();
    input.focus();
    onPick?.(value);
  };

  const setActive = (idx) => {
    activeIndex = idx;
    [...box.children].forEach((el, i) => {
      el.classList.toggle('active', i === idx);
      el.setAttribute('aria-selected', String(i === idx));
    });
  };

  const render = (suggestions) => {
    current = suggestions;
    box.innerHTML = '';
    if (!suggestions.length) { close(); return; }
    suggestions.forEach((sug, i) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'suggest-item';
      opt.setAttribute('role', 'option');
      opt.setAttribute('aria-selected', 'false');
      const cat = AUTOCOMPLETE_CATEGORY_CLASS[String(sug.category).toLowerCase()];
      if (cat) opt.classList.add(`suggest--${cat}`);
      const name = document.createElement('span');
      name.className = 'suggest-name';
      name.textContent = sug.label;
      opt.appendChild(name);
      if (sug.count > 0) {
        const count = document.createElement('span');
        count.className = 'suggest-count';
        count.textContent = sug.count >= 1000 ? `${Math.round(sug.count / 1000)}k` : String(sug.count);
        opt.appendChild(count);
      }
      // pointerdown fires before the input blur, so the pick still lands
      opt.addEventListener('pointerdown', (e) => { e.preventDefault(); applySuggestion(sug); });
      box.appendChild(opt);
    });
    box.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
    setActive(-1);
  };

  const query = async () => {
    const tok = currentToken();
    if (!tok) { close(); return; }
    const seq = ++requestSeq;
    const sites = enabledSites().slice(0, 4);
    if (!sites.length) { close(); return; }
    const settled = await Promise.allSettled(
      sites.map((site) => window.api.autocomplete({ site: { ...site, baseUrl: normalizeBaseUrl(site.baseUrl) }, prefix: tok.token, limit: 10 }))
    );
    if (seq !== requestSeq || document.activeElement !== input) return;
    const merged = new Map();
    for (const r of settled) {
      if (r.status !== 'fulfilled' || !r.value?.ok) continue;
      for (const s of r.value.suggestions || []) {
        const key = s.value.toLowerCase();
        const existing = merged.get(key);
        if (!existing || s.count > existing.count) merged.set(key, s);
      }
    }
    const list = [...merged.values()].sort((a, b) => b.count - a.count).slice(0, 10);
    render(list);
  };

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(query, 220);
  });
  input.addEventListener('keydown', (e) => {
    if (box.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(current.length - 1, activeIndex + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(-1, activeIndex - 1)); }
    else if (e.key === 'Enter' && activeIndex >= 0 && current[activeIndex]) { e.preventDefault(); applySuggestion(current[activeIndex]); }
    else if (e.key === 'Escape' || e.key === 'Tab') { close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
}

function setupFeedHeader() {
  const refresh = document.getElementById('btn-refresh-feed');
  refresh?.addEventListener('click', () => {
    if (!state.loading) refreshView(state.viewType);
  });

  const input = document.getElementById('tag-search');
  input?.setAttribute('title', 'Advanced Gelbooru syntax supported. Press / to focus search.');
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
    if (event.key === '/' && !editing && !window.SBOverlay?.isOpen()) {
      event.preventDefault();
      input?.focus();
      input?.select();
    } else if (event.key === 'Escape' && target === input) {
      input.blur();
    }
  });
  updateFeedHeader();
}
function setupManageSites() {
  document.getElementById('btn-manage-sites').addEventListener('click', ()=>{
    try {
      const modal = document.getElementById('site-manager');
      if (!window.renderSiteManager) throw new Error('renderSiteManager not loaded');
      window.renderSiteManager(modal, state.config, async (newCfg) => {
        state.config = { ...state.config, sites: newCfg.sites || [] };
        state.searchOrder = enabledSites().map((s)=> siteKey(s));
        renderSourceChips();
        clearFeed();
        await window.api.saveConfig(state.config);
        try {
          const acct = await window.api.accountGet?.();
          if (acct?.loggedIn) await window.api.sitesSaveRemote(state.config.sites || []);
        } catch {}
        scrollToTop();
        fetchBatch();
      }, () => {});
    } catch (err) {
      console.error('Manage Sites open failed:', err);
      notifyError('Failed to open Manage Sites. See Console for details.');
    }
  });
}
function setupSettings() {
  const openSettings = () => {
    const modal = document.getElementById('settings-manager');
    if (!modal || typeof window.renderSettings !== 'function') return;
    window.renderSettings(modal, {
      settings: { ...state.settings },
      nameTemplate: state.nameTemplate || '',
      onChange: async (patch) => {
        if (Object.prototype.hasOwnProperty.call(patch, 'nameTemplate')) {
          setNameTemplate(patch.nameTemplate);
          return;
        }
        await window.updateAppSettings(patch);
      }
    });
  };
  // mnu-settings is forwarded to btn-settings by the mobile menu
  document.getElementById('btn-settings')?.addEventListener('click', openSettings);
}
function setupInfiniteScroll() {
  // Scroll-based fallback, coalesced to one layout read per frame
  let scrollScheduled = false;
  const onScroll = ()=>{
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
      scrollScheduled = false;
      if (window.SBOverlay?.isOpen()) return;
      if (!state.orderLock && getScrollY() > 300) state.orderLock = true;
      const nearBottom = (window.innerHeight + getScrollY()) >= (getScrollHeight() - 800);
      if (nearBottom && !state.loading && !state.noMoreResults) fetchBatch();
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  // IntersectionObserver sentinel (more reliable on Android WebView)
  if ('IntersectionObserver' in window) {
    try {
      state._io?.disconnect?.();
    } catch {}
    try {
      state._io = new IntersectionObserver((entries)=>{
        if (window.SBOverlay?.isOpen()) return;
        for (const en of entries) {
          if (en.isIntersecting && !state.loading && !state.noMoreResults) {
            fetchBatch();
          }
        }
      }, { root: null, rootMargin: '1200px 0px', threshold: 0 });
      observeSentinel();
    } catch {}
  }
}

// ---------- Events: config + instant favorites + account ----------
(function subscribeConfigEvents() {
  window.events?.onConfigChanged?.(async (cfg) => {
    if (!cfg || typeof cfg !== 'object') return;
    const sitesChanged = JSON.stringify(cfg.sites || []) !== JSON.stringify(state.config?.sites || []);
    state.config = cfg;
    state.nameTemplate = typeof cfg.nameTemplate === 'string' && cfg.nameTemplate.trim() ? cfg.nameTemplate.trim() : null;
    state.settings = { ...DEFAULT_SETTINGS, ...(cfg.settings || {}) };
    applySettings();
    renderSourceChips();
    if (sitesChanged) {
      state.searchOrder = enabledSites().map((s)=> siteKey(s));
      for (const k of Object.keys(state.viewCache)) invalidateViewCache(k);
      clearFeed(); scrollToTop(); fetchBatch();
    }
  });
})();
(function subscribeFavoriteEvents() {
  window.events?.onFavoritesChanged?.(async () => {
    try {
      const keys = await (window.api?.getLocalFavoriteKeys?.() || []);
      window.__localFavsSet = new Set(keys || []);
    } catch {}

    // Invalidate the cached Favourites view so switching to it reloads fresh data
    if (state.viewCache?.faves) {
      invalidateViewCache('faves');
    }

    if (state.viewType === 'faves') {
      // The list has to be rebuilt, but the user may be a long way down it, so put them
      // back where they were instead of at the top.
      const y = window.scrollY || 0;
      clearFeed();
      await fetchBatch();
      if (y) window.scrollTo(0, y);
    }
  });
})();
(function subscribeAccountEvents() {
  window.events?.onAccountChanged?.(async () => {
    if (state.viewType === 'faves') {
      clearFeed(); scrollToTop(); await fetchBatch();
    }
  });
})();

// ---------- source-site favouriting (danbooru/moebooru/e621 with creds) ----------
function siteConfigForPost(post) {
  const target = normalizeBaseUrl(post?.site?.baseUrl || '');
  const type = post?.site?.type || '';
  if (!target || !type) return null;
  return configuredSites().find((s) => s.type === type && normalizeBaseUrl(s.baseUrl) === target) || null;
}

// Configured site with credentials that allow faving upstream, or null
function sourceFaveSite(post) {
  if (typeof window.api?.favoritePost !== 'function') return null;
  // the favourite-capable adapters live in the Electron main process
  if (!window.Platform?.isElectron?.()) return null;
  const site = siteConfigForPost(post);
  if (!site) return null;
  const c = site.credentials || {};
  if (site.type === 'danbooru' && c.login && c.api_key) return site;
  if (site.type === 'moebooru' && c.login && c.password_hash) return site;
  if (site.type === 'e621' && c.login && c.api_key) return site;
  return null;
}

async function syncFaveToSource(post, favorited) {
  const site = sourceFaveSite(post);
  if (!site) return;
  const label = site.name || site.type;
  try {
    const res = await window.api.favoritePost({ site, postId: post.id, action: favorited ? 'add' : 'remove' });
    if (!res?.ok) throw new Error(res?.error || 'unknown error');
    post.user_favorited = favorited;
    refreshSbFaveCount(post);
  } catch (e) {
    if (favorited) {
      notifyError(`Faved locally, but ${label} rejected the favourite: ${e?.message || e}`);
    } else {
      // Removing a fave that never existed on the site is expected noise
      console.warn(`[source-fave] remove on ${label} failed:`, e?.message || e);
    }
  }
}

window.hasRemoteFavoriteSupport = (post) => !!sourceFaveSite(post);
window.toggleRemoteFavorite = async (post) => {
  const site = sourceFaveSite(post);
  if (!site) return { ok: false, error: 'No source-site credentials configured' };
  const currently = !!(post.user_favorited || post._remote_favorited);
  try {
    const res = await window.api.favoritePost({ site, postId: post.id, action: currently ? 'remove' : 'add' });
    if (!res?.ok) return { ok: false, error: res?.error || 'failed' };
    post.user_favorited = !currently;
    post._remote_favorited = !currently;
    refreshSbFaveCount(post);
    return { ok: true, favorited: !currently };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
};

// ---------- Local favorites ----------
window.isLocalFavorite = (post) => (window.__localFavsSet || new Set()).has(itemKey(post));

window.toggleLocalFavorite = async (post) => {
  try {
    const res = await window.api.toggleLocalFavorite(post);
    window.__localFavsSet = window.__localFavsSet || new Set(await (window.api?.getLocalFavoriteKeys?.() || []));
    const key = res?.key || itemKey(post);
    if (res?.ok) {
      if (res.favorited) window.__localFavsSet.add(key);
      else window.__localFavsSet.delete(key);
      syncFaveToSource(post, !!res.favorited);
      // let the remote push land before re-asking for the count
      setTimeout(() => refreshSbFaveCount(post), 1500);
      if (state.viewType === 'faves') { clearFeed(); scrollToTop(); await fetchBatch(); }
    } else {
      notifyError(`Fave failed: ${res?.error || 'unknown error'}`);
    }
    return res;
  } catch (e) {
    console.error('toggleLocalFavorite error:', e);
    notifyError(`Fave failed: ${e?.message || e}`);
    return { ok: false, error: String(e?.message || e) };
  }
};

// ---------- bootstrap ----------
async function init() {
  await loadConfig();
  try { const keys = await (window.api?.getLocalFavoriteKeys?.() || []); window.__localFavsSet = new Set(keys || []); } catch {}
  setupTabs();
  setupSearch();
  setupFeedHeader();
  setupManageSites();
  setupSettings();
  setupInfiniteScroll();
  setupDownloadAll();
  renderSourceChips();

  setActiveTab();

  if (!restoreViewCache({ preserveScroll: false })) {
    clearFeed();
    scrollToTop();
    fetchBatch();
  } else {
    scrollToTop();
  }
}
init();
