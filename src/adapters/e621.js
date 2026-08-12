const { normalizePost, abs, isVideoUrl } = require('./base');

// e621/e926 adapter
class E621Adapter {
  constructor(httpGetJson, httpPostForm, httpDelete) {
    this.httpGetJson = httpGetJson;
    this.httpPostForm = httpPostForm;
    this.httpDelete = httpDelete;
  }

  #buildTags(site, extra = '') {
    const rating = (site.rating || '').toLowerCase();
    const rt = rating === 'safe' ? 'rating:s' : rating === 'questionable' ? 'rating:q' : rating === 'explicit' ? 'rating:e' : '';
    const parts = [rt, site.tags || '', extra || '']
      .filter(Boolean)
      .join(' ')
      .trim()
      .split(/\s+/);
    const seen = new Set();
    const out = [];
    for (const t of parts) if (!seen.has(t)) { seen.add(t); out.push(t); }
    return out.join(' ');
  }

  #withAuth(params, site) {
    const login = String(site?.credentials?.login || site?.login || '').trim();
    const apiKey = String(site?.credentials?.api_key || site?.api_key || '').trim();
    if (login && apiKey) {
      params.set('login', login);
      params.set('api_key', apiKey);
    }
  }

  #norm(site, p) {
    const base = (site.baseUrl || '').replace(/\/+$/, '');
    const score = (p?.score && typeof p.score === 'object') ? (p.score.total ?? 0) : (p?.score ?? 0);
    const tagsObj = p?.tags || {};
    const tagList = Object.values(tagsObj).flat().filter(Boolean);
    const file = p?.file || {};
    const sample = p?.sample || {};
    const preview = p?.preview || {};
    const fileUrl = file.url || sample.url || '';
    const isVideo = /^video\//.test(String(file.ext || '')) || isVideoUrl(fileUrl);
    const src = Array.isArray(p?.sources) && p.sources.length > 0 ? p.sources[0] : p?.source || '';
    return normalizePost({
      id: p.id,
      created_at: p.created_at,
      score,
      favorites: p.fav_count ?? 0,
      preview_url: abs(base, preview.url || ''),
      sample_url: abs(base, sample.url || file.url || ''),
      file_url: abs(base, file.url || sample.url || ''),
      width: file.width || null,
      height: file.height || null,
      tags: tagList,
      artist: Array.isArray(tagsObj.artist) ? tagsObj.artist : [],
      copyright: Array.isArray(tagsObj.copyright) ? tagsObj.copyright : [],
      character: Array.isArray(tagsObj.character) ? tagsObj.character : [],
      rating: p.rating || '',
      source: src,
      post_url: `${base}/posts/${p.id}`,
      site: { name: site.name, type: site.type, baseUrl: site.baseUrl },
      grid_video_url: isVideo ? abs(base, file.url || sample.url || '') : '',
      is_video: isVideo
    });
  }

  #isVisible(p) {
    const flags = p?.flags || {};
    return !flags.deleted;
  }

  async fetchNew(site, { cursor, limit = 40, search = '' }) {
    const base = (site.baseUrl || '').replace(/\/+$/, '');
    const params = new URLSearchParams();
    params.set('limit', String(Math.min(limit, 320)));
    const tags = this.#buildTags(site, 'order:id_desc ' + (search || ''));
    if (tags) params.set('tags', tags);
    this.#withAuth(params, site);
    const beforeId = cursor?.before_id;
    if (beforeId) params.set('page', `b${beforeId}`);
    const url = `${base}/posts.json?${params.toString()}`;
    const data = await this.httpGetJson(url, { Accept: 'application/json' });
    const posts = Array.isArray(data?.posts) ? data.posts : Array.isArray(data) ? data : [];
    const visible = posts.filter((p) => this.#isVisible(p));
    const normalized = visible.map((p) => this.#norm(site, p));
    const minId = visible.reduce((m, p) => (m == null ? p.id : Math.min(m, p.id)), null);
    return { posts: normalized, nextCursor: minId ? { before_id: minId } : cursor || null };
  }

  async fetchPopular(site, { cursor, limit = 40, search = '' }) {
    const base = (site.baseUrl || '').replace(/\/+$/, '');
    const params = new URLSearchParams();
    params.set('limit', String(Math.min(limit, 320)));
    const page = cursor?.page || 1;
    params.set('page', String(page));
    const tags = this.#buildTags(site, 'order:score ' + (search || ''));
    if (tags) params.set('tags', tags);
    this.#withAuth(params, site);
    const url = `${base}/posts.json?${params.toString()}`;
    const data = await this.httpGetJson(url, { Accept: 'application/json' });
    const posts = Array.isArray(data?.posts) ? data.posts : Array.isArray(data) ? data : [];
    const visible = posts.filter((p) => this.#isVisible(p));
    const normalized = visible.map((p) => this.#norm(site, p));
    return { posts: normalized, nextCursor: { page: page + 1 } };
  }

  async favorite(site, postId, action = 'add') {
    const login = String(site?.credentials?.login || '').trim();
    const apiKey = String(site?.credentials?.api_key || '').trim();
    if (!login || !apiKey) throw new Error('e621 favourites require login + API key.');
    if (typeof this.httpPostForm !== 'function' || typeof this.httpDelete !== 'function') {
      throw new Error('Favourites are not supported in this client.');
    }
    const base = (site.baseUrl || '').replace(/\/+$/, '');
    const cred = `login=${encodeURIComponent(login)}&api_key=${encodeURIComponent(apiKey)}`;
    if (action === 'remove') {
      return await this.httpDelete(`${base}/favorites/${encodeURIComponent(postId)}.json?${cred}`);
    }
    return await this.httpPostForm(`${base}/favorites.json?${cred}`, { post_id: String(postId) });
  }

  async autocomplete(site, prefix, { limit = 10 } = {}) {
    const q = String(prefix || '').trim();
    if (q.length < 3) return []; // e621 requires at least 3 characters
    const base = (site.baseUrl || '').replace(/\/+$/, '');
    const params = new URLSearchParams();
    params.set('search[name_matches]', q);
    params.set('limit', String(Math.min(limit, 20)));
    const res = await this.httpGetJson(`${base}/tags/autocomplete.json?${params.toString()}`, { Accept: 'application/json' });
    return (Array.isArray(res) ? res : [])
      .filter((t) => t && t.name)
      .map((t) => ({
        value: String(t.name),
        label: String(t.name),
        count: Number(t.post_count) || 0,
        category: String(t.category ?? '')
      }));
  }
}

module.exports = E621Adapter;
