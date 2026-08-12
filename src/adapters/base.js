function toIsoDate(d) {
  if (!d) return null;
  try {
    if (typeof d === 'number') {
      if (d < 1e12) return new Date(d * 1000).toISOString();
      return new Date(d).toISOString();
    }
    const dt = new Date(d);
    if (!isNaN(dt.getTime())) return dt.toISOString();
  } catch {}
  return null;
}

function abs(baseUrl, url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return baseUrl.replace(/\/+$/, '') + url;
  return url;
}

function isVideoUrl(url) {
  if (!url) return false;
  try {
    const path = new URL(url, 'https://x/').pathname.toLowerCase();
    return /\.(mp4|webm|mov|m4v)$/i.test(path);
  } catch {
    return /\.(mp4|webm|mov|m4v)$/i.test(String(url).toLowerCase());
  }
}

/** First URL that is not a video file (safe for &lt;img&gt; thumbnails). */
function pickStaticImageUrl(...urls) {
  for (const u of urls) {
    const s = String(u || '').trim();
    if (s && !isVideoUrl(s)) return s;
  }
  return '';
}

function ratingToTag(rating) {
  switch ((rating || '').toLowerCase()) {
    case 'safe': return 'rating:safe';
    case 'questionable': return 'rating:questionable';
    case 'explicit': return 'rating:explicit';
    default: return '';
  }
}

// Accept any number of extra tag strings which are appended
function buildQueryTags(site, ...extras) {
  const supplied = [site.tags || '', ...(extras || [])].filter(Boolean).join(' ');
  const hasRating = /(?:^|\s)-?rating:(?:safe|questionable|explicit|any|[sqe])(?:\s|$)/i.test(supplied);
  const parts = [hasRating ? '' : ratingToTag(site.rating), site.tags || '', ...(extras || [])]
    .filter(Boolean)
    .join(' ')
    .trim()
    .split(/\s+/);
  const seen = new Set();
  const out = [];
  for (const t of parts) if (!seen.has(t)) { seen.add(t); out.push(t); }
  return out.join(' ');
}

function toTagArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
  return [];
}

function normalizePost({
  id, created_at, score, favorites,
  preview_url, sample_url, file_url,
  width, height, tags, rating, source, post_url, site,
  grid_video_url, is_video, user_favorited,
  artist, copyright, character
}) {
  const staticPreview = pickStaticImageUrl(preview_url, sample_url, file_url);
  const sample = sample_url || file_url || '';
  const file = file_url || sample_url || preview_url || '';
  return {
    id: String(id),
    created_at: toIsoDate(created_at) || null,
    score: typeof score === 'number' ? score : score ? Number(score) || 0 : 0,
    favorites: typeof favorites === 'number' ? favorites : favorites ? Number(favorites) || 0 : 0,
    preview_url: staticPreview || '',
    sample_url: sample,
    file_url: file,
    width: width ? Number(width) : null,
    height: height ? Number(height) : null,
    tags: toTagArray(tags),
    artist: toTagArray(artist),
    copyright: toTagArray(copyright),
    character: toTagArray(character),
    rating: rating || '',
    source: source || '',
    post_url,
    site,
    grid_video_url: grid_video_url || '',
    is_video: !!is_video,
    user_favorited: !!user_favorited
  };
}

module.exports = { normalizePost, toIsoDate, abs, buildQueryTags, ratingToTag, isVideoUrl, pickStaticImageUrl, toTagArray };
