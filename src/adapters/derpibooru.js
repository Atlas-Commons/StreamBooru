const { normalizePost, abs, pickStaticImageUrl, isVideoUrl } = require('./base');

// Derpibooru adapter (API: /api/v1/json/search/images)
class DerpibooruAdapter {
  constructor(httpGetJson) {
    this.httpGetJson = httpGetJson;
  }

  #buildQuery(site, extra = '') {
    // Derpibooru uses rating tags like "safe", "questionable", "explicit"
    const rating = (site.rating || '').toLowerCase();
    const rt = rating === 'safe' ? 'safe'
      : rating === 'questionable' ? 'questionable'
      : rating === 'explicit' ? 'explicit'
      : ''; // 'any' => no rating token
    return [rt, site.tags || '', extra || '']
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  #norm(site, img) {
    const base = (site.baseUrl || '').replace(/\/+$/, '');
    const rep = img?.representations || {};
    const file = rep.full || img?.view_url || '';
    const sample = rep.large || rep.medium || file;
    const previewPath = pickStaticImageUrl(rep.small, rep.medium, rep.large, rep.thumb) || pickStaticImageUrl(sample);
    const isVideo = /^video\//.test(String(img?.mime_type || '')) || isVideoUrl(file);
    const gridVideo = isVideo
      ? (rep.thumb_small || rep.thumb || rep.small || file)
      : '';

    const tagsArr = Array.isArray(img?.tags)
      ? img.tags
      : (typeof img?.tags === 'string' ? img.tags.split(',').map((t)=>t.trim()) : []);

    // Derpibooru encodes categories as namespaced tags (artist:foo, oc:bar)
    const byPrefix = (prefix) => tagsArr
      .filter((t) => String(t).toLowerCase().startsWith(prefix))
      .map((t) => String(t).slice(prefix.length).trim())
      .filter(Boolean);

    return normalizePost({
      id: img.id,
      created_at: img.created_at,
      score: img.score ?? ((img.upvotes || 0) - (img.downvotes || 0)),
      favorites: img.faves ?? img.favorites ?? 0,
      preview_url: abs(base, previewPath || ''),
      sample_url: abs(base, sample || ''),
      file_url: abs(base, file || ''),
      width: img.width || null,
      height: img.height || null,
      tags: tagsArr,
      artist: byPrefix('artist:'),
      character: byPrefix('oc:'),
      rating: (Array.isArray(tagsArr) ? tagsArr : []).includes('explicit')
        ? 'explicit'
        : (Array.isArray(tagsArr) && tagsArr.includes('questionable') ? 'questionable' : 'safe'),
      source: Array.isArray(img?.source_url) ? (img.source_url[0] || '') : (img.source_url || ''),
      post_url: `${base}/images/${img.id}`,
      site: { name: site.name, type: site.type, baseUrl: site.baseUrl },
      grid_video_url: abs(base, gridVideo || ''),
      is_video: isVideo
    });
  }

  async #fetch(site, { cursor, limit = 40, search = '', sortField = 'created_at', sortDir = 'desc' }) {
    const base = (site.baseUrl || '').replace(/\/+$/, '');
    const params = new URLSearchParams();
    params.set('per_page', String(Math.min(limit, 50)));
    const page = cursor?.page || 1;
    params.set('page', String(page));

    // Build query and ensure non-empty
    let q = this.#buildQuery(site, search).trim();
    if (!q) q = 'score.gte:0';
    params.set('q', q);

    params.set('sf', sortField);
    params.set('sd', sortDir);

    // Optional API key applies the account's own filters/settings
    const apiKey = site?.credentials?.key || site?.credentials?.api_key || site?.key;
    if (apiKey) params.set('key', String(apiKey));

    // Optional: support custom filter to avoid default filter hiding content
    const filterId = site?.credentials?.filter_id || site?.filter_id;
    if (filterId) params.set('filter_id', String(filterId));

    const url = `${base}/api/v1/json/search/images?${params.toString()}`;
    const data = await this.httpGetJson(url, { Accept: 'application/json' });
    const images = Array.isArray(data?.images) ? data.images : [];
    const visible = images.filter((i) => !i.deleted);
    const normalized = visible.map((i) => this.#norm(site, i));
    return { posts: normalized, nextCursor: { page: page + 1 } };
  }

  async fetchNew(site, opts) {
    return this.#fetch(site, { ...opts, sortField: 'created_at', sortDir: 'desc' });
  }

  async fetchPopular(site, opts) {
    return this.#fetch(site, { ...opts, sortField: 'score', sortDir: 'desc' });
  }

  async autocomplete(site, prefix, { limit = 10 } = {}) {
    const q = String(prefix || '').trim();
    if (!q) return [];
    const base = (site.baseUrl || '').replace(/\/+$/, '');
    const params = new URLSearchParams();
    params.set('q', `${q.replace(/\*+$/, '')}*`);
    params.set('per_page', String(Math.min(limit, 20)));
    const data = await this.httpGetJson(`${base}/api/v1/json/search/tags?${params.toString()}`, { Accept: 'application/json' });
    return (Array.isArray(data?.tags) ? data.tags : [])
      .filter((t) => t && t.name)
      .map((t) => ({
        value: String(t.name).replace(/\s+/g, '+'),
        label: String(t.name),
        count: Number(t.images) || 0,
        category: String(t.category ?? '')
      }));
  }
}

module.exports = DerpibooruAdapter;
