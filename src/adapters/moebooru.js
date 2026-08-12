const { normalizePost, abs, buildQueryTags } = require('./base');

class MoebooruAdapter {
  constructor(httpGetJson, httpPostForm) {
    this.httpGetJson = httpGetJson;
    this.httpPostForm = httpPostForm;
  }

  async fetchNew(site, { cursor, limit = 40, search = '' }) {
    const page = cursor?.page || 1;
    const base = site.baseUrl.replace(/\/+$/, '');
    const params = new URLSearchParams();
    params.set('limit', String(Math.min(limit, 100)));
    params.set('page', String(page));

    const tagsPlain = buildQueryTags(site, search);
    if (tagsPlain) params.set('tags', tagsPlain);
    this.#augmentAuth(site, params);

    let url = `${base}/post.json?${params.toString()}`;
    let posts = [];
    try { posts = await this.httpGetJson(url); } catch { posts = []; }

    // Fallback when searching and nothing returned: try order:score
    if ((posts?.length || 0) === 0 && (search || '').trim().length > 0) {
      const params2 = new URLSearchParams();
      params2.set('limit', String(Math.min(limit, 100)));
      params2.set('page', String(page));
      params2.set('tags', buildQueryTags(site, 'order:score', search));
      this.#augmentAuth(site, params2);
      try { posts = await this.httpGetJson(`${base}/post.json?${params2.toString()}`); } catch { posts = []; }
    }

    const normalized = (posts || []).map((p) =>
      normalizePost({
        id: p.id,
        created_at: p.created_at || p.created_at_s || p.change,
        score: p.score,
        favorites: p.fav_count ?? p.favorite_count ?? 0,
        preview_url: abs(site.baseUrl, p.preview_url),
        sample_url: abs(site.baseUrl, p.sample_url || p.jpeg_url || p.file_url),
        file_url: abs(site.baseUrl, p.file_url || p.sample_url || p.jpeg_url),
        width: p.width,
        height: p.height,
        tags: p.tags ? p.tags.split(' ') : [],
        rating: p.rating,
        source: p.source,
        post_url: `${base}/post/show/${p.id}`,
        site: { name: site.name, type: site.type, baseUrl: site.baseUrl }
      })
    );

    return { posts: normalized, nextCursor: { page: page + 1 } };
  }

  async fetchPopular(site, { cursor, limit = 40, search = '' }) {
    const page = cursor?.page || 1;
    const base = site.baseUrl.replace(/\/+$/, '');
    const params = new URLSearchParams();
    params.set('limit', String(Math.min(limit, 100)));
    params.set('page', String(page));
    const tags = buildQueryTags(site, 'order:score', search);
    if (tags) params.set('tags', tags);
    this.#augmentAuth(site, params);

    const url = `${base}/post.json?${params.toString()}`;
    const posts = await this.httpGetJson(url);

    const normalized = (posts || []).map((p) =>
      normalizePost({
        id: p.id,
        created_at: p.created_at || p.created_at_s || p.change,
        score: p.score,
        favorites: p.fav_count ?? p.favorite_count ?? 0,
        preview_url: abs(site.baseUrl, p.preview_url),
        sample_url: abs(site.baseUrl, p.sample_url || p.jpeg_url || p.file_url),
        file_url: abs(site.baseUrl, p.file_url || p.sample_url || p.jpeg_url),
        width: p.width,
        height: p.height,
        tags: p.tags ? p.tags.split(' ') : [],
        rating: p.rating,
        source: p.source,
        post_url: `${base}/post/show/${p.id}`,
        site: { name: site.name, type: site.type, baseUrl: site.baseUrl }
      })
    );

    return { posts: normalized, nextCursor: { page: page + 1 } };
  }

  async authCheck(site) {
    if (!site.credentials?.login || !site.credentials?.password_hash) {
      return { ok: false, info: { reason: 'Missing login or password_hash' } };
    }
    const base = site.baseUrl.replace(/\/+$/, '');
    const params = new URLSearchParams();
    params.set('login', site.credentials.login);
    params.set('password_hash', site.credentials.password_hash);
    const url = `${base}/user.json?${params.toString()}`;
    const res = await this.httpGetJson(url);
    const info = {
      id: res?.id ?? null,
      name: res?.name ?? site.credentials.login,
      level: res?.level ?? res?.user_level ?? null
    };
    return { ok: !!(info.id || info.name), info };
  }

  async favorite(site, postId, action = 'add') {
    if (!site.credentials?.login || !site.credentials?.password_hash) {
      throw new Error('Moebooru favorites require login + password_hash.');
    }
    const base = site.baseUrl.replace(/\/+$/, '');
    const cred = `login=${encodeURIComponent(site.credentials.login)}&password_hash=${encodeURIComponent(
      site.credentials.password_hash
    )}`;
    if (action === 'remove') {
      const url = `${base}/favorite/destroy.json?post_id=${encodeURIComponent(postId)}&${cred}`;
      return await this.httpPostForm(url, {});
    }
    const url = `${base}/favorite/create.json?post_id=${encodeURIComponent(postId)}&${cred}`;
    return await this.httpPostForm(url, {});
  }

  async autocomplete(site, prefix, { limit = 10 } = {}) {
    const q = String(prefix || '').trim();
    if (!q) return [];
    const base = site.baseUrl.replace(/\/+$/, '');
    const params = new URLSearchParams();
    params.set('name', `${q.replace(/\*+$/, '')}*`);
    params.set('order', 'count');
    params.set('limit', String(Math.min(limit, 20)));
    const res = await this.httpGetJson(`${base}/tag.json?${params.toString()}`);
    return (Array.isArray(res) ? res : [])
      .filter((t) => t && t.name)
      .map((t) => ({
        value: String(t.name),
        label: String(t.name),
        count: Number(t.count) || 0,
        category: String(t.type ?? '')
      }));
  }

  #augmentAuth(site, params) {
    if (site.credentials?.login && site.credentials?.password_hash) {
      params.set('login', site.credentials.login);
      params.set('password_hash', site.credentials.password_hash);
    }
  }
}

module.exports = MoebooruAdapter;
