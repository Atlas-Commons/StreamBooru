const allowedTypes = new Set(['danbooru', 'moebooru', 'gelbooru', 'e621', 'derpibooru']);
const allowedRatings = new Set(['safe', 'questionable', 'explicit', 'any']);

function s(str, max = 512) {
  return String(str || '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function sName(str) { return s(str, 200); }
function sTags(str) { return s(str, 800); }

function sUrl(u) {
  try {
    const url = new URL(String(u || ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/+$/, '');
  } catch { return ''; }
}

function sType(t) { const v = String(t || '').toLowerCase(); return allowedTypes.has(v) ? v : ''; }
function sRating(r) {
  const v = String(r || '').toLowerCase();
  if (!v) return 'any';
  return allowedRatings.has(v) ? v : 'any';
}

function sanitizeCredentials(type, creds) {
  const out = {};
  const input = (creds && typeof creds === 'object') ? creds : {};
  const pick = (k, max = 512) => { if (input[k]) out[k] = s(String(input[k]), max); };
  if (type === 'danbooru') { pick('login', 200); pick('api_key', 200); }
  else if (type === 'moebooru') { pick('login', 200); pick('password_hash', 200); }
  else if (type === 'gelbooru') { pick('user_id', 200); pick('api_key', 200); }
  else if (type === 'e621') { pick('login', 200); pick('api_key', 200); }
  return out;
}

function sanitizeSiteInput(site) {
  const type = sType(site?.type);
  const base_url = sUrl(site?.baseUrl || site?.base_url);
  const name = sName(site?.name || base_url || type || 'Site');
  const rating = sRating(site?.rating);
  const tags = sTags(site?.tags);
  const dialect = String(site?.queryDialect || site?.query_dialect || 'auto').toLowerCase();
  const query_dialect = ['auto', 'gelbooru', 'rule34'].includes(dialect) ? dialect : 'auto';
  const credentials = sanitizeCredentials(type, site?.credentials);
  return { name, type, base_url, rating, tags, query_dialect, credentials };
}

function sanitizeFavoriteKey(key) { return s(key, 400); }

function clampPost(post) {
  if (!post || typeof post !== 'object') return null;
  const keep = {};
  const copy = (k, max = 2000) => {
    if (post[k] != null) keep[k] = typeof post[k] === 'string' ? s(post[k], max) : post[k];
  };
  ['id','created_at','score','favorites','preview_url','sample_url','file_url','width','height','tags','rating','source','post_url','site','user_favorited','_added_at'].forEach((k)=>copy(k));
  try {
    const bytes = Buffer.byteLength(JSON.stringify(keep),'utf8');
    if (bytes > 300000) return null;
  } catch { return null; }
  return keep;
}

module.exports = { sanitizeSiteInput, sanitizeCredentials, sanitizeFavoriteKey, clampPost };
