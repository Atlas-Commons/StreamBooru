const { normalizePost, abs, buildQueryTags } = require('./base');

class DanbooruAdapter {
  constructor(httpGetJson, httpPostForm, httpDelete) {
    this.httpGetJson = httpGetJson;
    this.httpPostForm = httpPostForm;
    this.httpDelete = httpDelete;
  }

  // Gold-only/restricted filter:
  // - Hide takedowns/deletions
  // - Hide posts with no full-size media visible to the current user:
  //   (no file_url AND no large_file_url AND no media_asset variant of type 'sample' or 'original')
  // - Respect is_visible === false if present
  #filterPostVisibility(p) {
    const isTakedown = p?.is_banned || p?.is_deleted;
    const explicitlyHidden = p?.is_visible === false;

    const variants = Array.isArray(p?.media_asset?.variants) ? p.media_asset.variants : [];
    const hasFullVariant = variants.some(v => v?.type === 'original' || v?.type === 'sample');

    const noFullUrls = !p?.file_url && !p?.large_file_url;
    const restrictedForThisUser = noFullUrls && !hasFullVariant;

    return !isTakedown && !explicitlyHidden && !restrictedForThisUser;
  }

  #mapPost(site, p) {
    return normalizePost({
      id: p.id,
      created_at: p.created_at,
      score: p.score,
      favorites: p.fav_count ?? p.favorite_count ?? 0,
      preview_url: abs(site.baseUrl, p.preview_file_url || p.preview_url),
      sample_url: abs(site.baseUrl, p.large_file_url || p.file_url),
      file_url: abs(site.baseUrl, p.file_url || p.large_file_url),
      width: p.image_width,
      height: p.image_height,
      tags: p.tag_string ? p.tag_string.split(' ') : [],
      artist: p.tag_string_artist || '',
      copyright: p.tag_string_copyright || '',
      character: p.tag_string_character || '',
      rating: p.rating,
      source: p.source,
      post_url: `${site.baseUrl.replace(/\/+$/, '')}/posts/${p.id}`,
      site: { name: site.name, type: site.type, baseUrl: site.baseUrl },
      user_favorited: !!p.is_favorited
    });
  }

  async #fetchPosts(site, { page, limit, tags, keepHidden = false }) {
    const params = new URLSearchParams();
    params.set('limit', String(Math.min(limit, 200)));
    params.set('page', String(page));
    if (tags) params.set('tags', tags);
    this.#augmentAuth(site, params);

    const url = `${site.baseUrl.replace(/\/+$/, '')}/posts.json?${params.toString()}`;
    const posts = await this.httpGetJson(url);
    return {
      posts: (posts || [])
        .filter((p) => keepHidden || this.#filterPostVisibility(p))
        .map((p) => this.#mapPost(site, p)),
      nextCursor: { page: page + 1 }
    };
  }

  async fetchNew(site, { cursor, limit = 40, search = '' }) {
    const page = cursor?.page || 1;
    return this.#fetchPosts(site, { page, limit, tags: buildQueryTags(site, search) });
  }

  async fetchPopular(site, { cursor, limit = 40, search = '' }) {
    const page = cursor?.page || 1;
    return this.#fetchPosts(site, { page, limit, tags: buildQueryTags(site, 'order:rank', search) });
  }

  async autocomplete(site, prefix, { limit = 10 } = {}) {
    const q = String(prefix || '').trim();
    if (!q) return [];
    const base = site.baseUrl.replace(/\/+$/, '');
    const params = new URLSearchParams();
    params.set('search[query]', q);
    params.set('search[type]', 'tag_query');
    params.set('limit', String(Math.min(limit, 20)));
    const res = await this.httpGetJson(`${base}/autocomplete.json?${params.toString()}`);
    return (Array.isArray(res) ? res : [])
      .filter((t) => t && (t.value || t.label))
      .map((t) => ({
        value: String(t.value || t.label),
        label: String(t.label || t.value),
        count: Number(t.post_count) || 0,
        category: String(t.category ?? '')
      }));
  }

  // The account's own favourites, most recently faved first. The site's tag and rating
  // filters are left off on purpose: ordfav: already spends one of the two search tags a
  // free Danbooru account gets, and a fave the user made is one they want back.
  //
  // Nothing is filtered out either. A sync reads absence from this list as an unfave, and a
  // post the site has since banned is still faved — dropping it here would delete it locally.
  async listFavorites(site, { page = 1, limit = 200 } = {}) {
    const login = String(site?.credentials?.login || '').trim();
    if (!login || !site?.credentials?.api_key) {
      throw new Error('Danbooru favorites require login + API key.');
    }
    return this.#fetchPosts(site, { page, limit, tags: `ordfav:${login}`, keepHidden: true });
  }

  async favorite(site, postId, action = 'add') {
    if (!site.credentials?.login || !site.credentials?.api_key) {
      throw new Error('Danbooru favorites require login + API key.');
    }
    const base = site.baseUrl.replace(/\/+$/, '');
    if (action === 'remove') {
      const url = `${base}/favorites/${encodeURIComponent(postId)}.json?login=${encodeURIComponent(
        site.credentials.login
      )}&api_key=${encodeURIComponent(site.credentials.api_key)}`;
      return await this.httpDelete(url);
    }
    const url = `${base}/favorites.json?login=${encodeURIComponent(site.credentials.login)}&api_key=${encodeURIComponent(
      site.credentials.api_key
    )}`;
    return await this.httpPostForm(url, { post_id: String(postId) });
  }

  async authCheck(site) {
    if (!site.credentials?.login || !site.credentials?.api_key) {
      return { ok: false, info: { reason: 'Missing login or API key' } };
    }
    const base = site.baseUrl.replace(/\/+$/, '');
    const url = `${base}/profile.json?login=${encodeURIComponent(site.credentials.login)}&api_key=${encodeURIComponent(
      site.credentials.api_key
    )}`;
    const prof = await this.httpGetJson(url);
    const info = {
      id: prof?.id ?? null,
      name: prof?.name ?? site.credentials.login,
      level: prof?.level ?? null
    };
    return { ok: true, info };
  }

  #augmentAuth(site, params) {
    if (site.credentials?.login && site.credentials?.api_key) {
      params.set('login', site.credentials.login);
      params.set('api_key', site.credentials.api_key);
    }
  }
}

module.exports = DanbooruAdapter;
