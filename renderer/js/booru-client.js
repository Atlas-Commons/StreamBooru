(function () {
  'use strict';

  window.createBooruClient = function ({ httpGetJSON, httpGetText, isVideoMediaUrl }) {
    const queryDialects = window.StreamBooruQueryDialect || {};
    const ensureHttps = (value) => {
      try { const url = new URL(value); if (url.protocol === 'http:') url.protocol = 'https:'; return url.toString(); }
      catch { return value; }
    };
    const splitTags = (value) => String(value || '').split(/\s+/).map((tag) => tag.trim()).filter(Boolean);
    const toISO = (value) => {
      try {
        if (!value) return '';
        const date = new Date(typeof value === 'number' ? value * 1000 : value);
        return Number.isNaN(date.getTime()) ? '' : date.toISOString();
      } catch { return ''; }
    };
    const ratingToTag = (rating) => ({ safe: 'rating:safe', questionable: 'rating:questionable', explicit: 'rating:explicit' })[String(rating || '').toLowerCase()] || '';
    const buildQueryTags = (site, ...extras) => {
      const seen = new Set();
      const supplied = [site?.tags || '', ...extras].filter(Boolean).join(' ');
      const hasRating = /(?:^|\s)-?rating:(?:safe|questionable|explicit|any|[sqe])(?:\s|$)/i.test(supplied);
      return [hasRating ? '' : ratingToTag(site?.rating), site?.tags || '', ...extras]
        .filter(Boolean).join(' ').trim().split(/\s+/)
        .filter((tag) => tag && !seen.has(tag) && seen.add(tag)).join(' ');
    };
    const hasRatingSpecifier = (tags) => /\brating\s*:(?:safe|questionable|explicit|any|[sqe])\b/i.test(String(tags || ''));
    const addRatingToken = (tags, rating) => {
      const token = rating === 'questionable' ? 'rating:questionable' : rating === 'explicit' ? 'rating:explicit' : 'rating:safe';
      return tags ? `${token} ${tags}` : token;
    };
    const canonRating = (rating) => {
      const value = String(rating || '').toLowerCase();
      if (value === 'g' || value === 'general' || value.startsWith('s')) return 's';
      if (value.startsWith('q') || value === 'sensitive' || value === 'mature') return 'q';
      return value.startsWith('e') ? 'e' : '';
    };

    function normalizeDanbooru(post, site) {
      const base = String(site?.baseUrl || '').replace(/\/+$/, '');
      return {
        id: post.id, score: post.score ?? 0, favorites: post.fav_count ?? post.favorites ?? 0,
        rating: post.rating || '', width: post.image_width ?? post.width ?? 0,
        height: post.image_height ?? post.height ?? 0, created_at: post.created_at || post.created_at_s || '',
        tags: splitTags(post.tag_string),
        artist: splitTags(post.tag_string_artist), copyright: splitTags(post.tag_string_copyright), character: splitTags(post.tag_string_character),
        file_url: post.file_url ? ensureHttps(post.file_url) : '',
        sample_url: post.large_file_url ? ensureHttps(post.large_file_url) : (post.file_url ? ensureHttps(post.file_url) : ''),
        preview_url: post.preview_file_url ? ensureHttps(post.preview_file_url) : '', post_url: `${base}/posts/${post.id}`, site
      };
    }
    function normalizeMoebooru(post, site) {
      const base = String(site?.baseUrl || '').replace(/\/+$/, '');
      return {
        id: post.id, score: post.score ?? 0, favorites: post.fav_count ?? post.favorites ?? 0,
        rating: post.rating || '', width: post.width ?? 0, height: post.height ?? 0,
        created_at: toISO(post.created_at), tags: splitTags(post.tags),
        file_url: post.file_url ? ensureHttps(post.file_url) : '',
        sample_url: post.sample_url ? ensureHttps(post.sample_url) : (post.file_url ? ensureHttps(post.file_url) : ''),
        preview_url: post.preview_url ? ensureHttps(post.preview_url) : '', post_url: `${base}/post/show/${post.id}`, site
      };
    }
    function normalizeGelbooru(post, site) {
      const base = String(site?.baseUrl || '').replace(/\/+$/, '');
      const id = post.id || post.post_id || post.hash || '';
      const file = post.file_url || post.fileURL || post.source || '';
      const sample = post.sample_url || post.sampleURL || '';
      const preview = post.preview_url || post.previewURL || '';
      return {
        id, score: Number(post.score ?? 0) || 0,
        favorites: Number(post.favorite_count ?? post.fav_count ?? post.favorites ?? 0) || 0,
        rating: post.rating || '', width: Number(post.width ?? 0) || 0, height: Number(post.height ?? 0) || 0,
        created_at: toISO(post.created_at || post.created_at_s), tags: splitTags(post.tags),
        file_url: file ? ensureHttps(file) : '', sample_url: sample ? ensureHttps(sample) : (file ? ensureHttps(file) : ''),
        preview_url: preview ? ensureHttps(preview) : '',
        post_url: `${base}/index.php?page=post&s=view&id=${encodeURIComponent(id)}`, site
      };
    }
    function normalizeE621(post, site) {
      const base = String(site?.baseUrl || '').replace(/\/+$/, '');
      const file = post?.file || {}; const sample = post?.sample || {}; const preview = post?.preview || {};
      const fileUrl = file.url ? ensureHttps(file.url) : '';
      const sampleUrl = sample.url ? ensureHttps(sample.url) : fileUrl;
      const previewUrl = preview.url ? ensureHttps(preview.url) : '';
      const isVideo = ['webm', 'mp4', 'm4v', 'mov'].includes(String(file.ext || '').toLowerCase()) || isVideoMediaUrl(fileUrl);
      const tagsObj = post.tags || {};
      return {
        id: post.id, score: Number(post?.score?.total ?? post?.score ?? 0) || 0,
        favorites: Number(post?.fav_count ?? 0) || 0, rating: post.rating || '',
        width: Number(file.width ?? 0) || 0, height: Number(file.height ?? 0) || 0,
        created_at: post.created_at || '', tags: Object.values(tagsObj).flat().filter(Boolean),
        artist: Array.isArray(tagsObj.artist) ? tagsObj.artist : [],
        copyright: Array.isArray(tagsObj.copyright) ? tagsObj.copyright : [],
        character: Array.isArray(tagsObj.character) ? tagsObj.character : [],
        file_url: fileUrl || sampleUrl, sample_url: sampleUrl, preview_url: previewUrl,
        post_url: `${base}/posts/${post.id}`, grid_video_url: isVideo ? (fileUrl || sampleUrl) : '', is_video: isVideo, site
      };
    }

    const credential = (site, key) => site?.credentials?.[key] || site?.[key] || '';
    const addCredentials = (params, site, userKey = 'login') => {
      const user = credential(site, userKey); const apiKey = credential(site, 'api_key');
      if (user && apiKey) { params.set(userKey, user); params.set('api_key', apiKey); }
    };
    const postParams = ({ tags, page, limit }) => {
      const params = new URLSearchParams();
      if (limit) params.set('limit', String(limit));
      if (tags) params.set('tags', tags);
      if (page) params.set('page', String(page));
      return params;
    };
    async function fetchDanbooru(args) {
      const params = postParams(args); addCredentials(params, args.site);
      const url = `${args.baseUrl.replace(/\/+$/, '')}/posts.json?${params}`;
      const json = await httpGetJSON(url);
      return Array.isArray(json) ? json : [];
    }
    async function fetchMoebooru(args) {
      const params = postParams(args);
      const json = await httpGetJSON(`${args.baseUrl.replace(/\/+$/, '')}/post.json?${params}`);
      return Array.isArray(json) ? json : [];
    }
    function parseGelbooruXml(xml) {
      try {
        return [...new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('post')]
          .map((node) => Object.fromEntries([...node.attributes].map((attribute) => [attribute.name, attribute.value])));
      } catch { return []; }
    }
    async function fetchGelbooru(args) {
      const params = new URLSearchParams({ page: 'dapi', s: 'post', q: 'index', json: '1' });
      if (args.limit) params.set('limit', String(args.limit));
      if (args.tags) params.set('tags', queryDialects.translateGelbooruQuery?.(args.tags, args.site) || args.tags);
      if (args.page) params.set('pid', String((args.page - 1) || 0));
      addCredentials(params, args.site, 'user_id');
      const base = queryDialects.gelbooruApiBase?.(args.baseUrl, args.site) || args.baseUrl.replace(/\/+$/, '');
      try {
        const json = await httpGetJSON(`${base}/index.php?${params}`);
        return Array.isArray(json) ? json : (Array.isArray(json?.post) ? json.post : []);
      } catch {
        params.delete('json');
        return parseGelbooruXml(await httpGetText(`${base}/index.php?${params}`));
      }
    }
    async function fetchE621(args) {
      const params = postParams({ ...args, limit: Math.min(Number(args.limit) || 40, 320) });
      if (params.has('tags')) params.set('tags', params.get('tags')
        .replace(/\brating:safe\b/gi, 'rating:s').replace(/\brating:questionable\b/gi, 'rating:q').replace(/\brating:explicit\b/gi, 'rating:e'));
      addCredentials(params, args.site);
      const json = await httpGetJSON(`${args.baseUrl.replace(/\/+$/, '')}/posts.json?${params}`);
      return Array.isArray(json?.posts) ? json.posts.filter((post) => !post?.flags?.deleted) : [];
    }

    async function fetchBooruWeb(payload) {
      const { site, viewType, cursor, limit = 40, search = '' } = payload || {};
      if (!site?.baseUrl) return { posts: [], nextCursor: null };
      const page = typeof cursor === 'number' && cursor > 0 ? cursor : 1;
      const popular = { danbooru: 'order:rank', moebooru: 'order:score', gelbooru: 'sort:score', e621: 'order:score' }[site.type] || 'order:rank';
      const extras = [viewType === 'popular' ? popular : '', search.trim()].filter(Boolean);
      const hasExplicitRating = hasRatingSpecifier([site.tags || '', ...extras].join(' '));
      let tags = buildQueryTags(site, ...extras);
      const rating = String(site.rating || '').toLowerCase();
      let injectedRating = !hasExplicitRating && rating && rating !== 'any'
        ? (rating.startsWith('q') ? 'q' : rating.startsWith('e') ? 'e' : 's')
        : '';
      if (!hasRatingSpecifier(tags) && rating && rating !== 'any') {
        tags = addRatingToken(tags, rating);
      }

      const args = { baseUrl: site.baseUrl, tags, page, limit, site };
      let raw = [];
      try {
        if (site.type === 'danbooru') {
          args.limit = Math.min(30, limit);
          raw = await fetchDanbooru(args);
          if (viewType === 'popular' && raw.length === 0) {
            args.tags = tags.includes('order:rank') ? tags.replace('order:rank', 'order:score') : `order:score ${tags}`;
            raw = await fetchDanbooru(args);
          }
        } else if (site.type === 'moebooru') raw = await fetchMoebooru(args);
        else if (site.type === 'gelbooru') raw = await fetchGelbooru(args);
        else if (site.type === 'e621') raw = await fetchE621(args);
        else raw = await fetchDanbooru({ ...args, limit: Math.min(30, limit) });
      } catch { raw = []; }

      const normalizer = { danbooru: normalizeDanbooru, moebooru: normalizeMoebooru, gelbooru: normalizeGelbooru, e621: normalizeE621 }[site.type] || normalizeDanbooru;
      let posts = raw.map((post) => { try { return normalizer(post, site); } catch { return null; } }).filter(Boolean);
      if (injectedRating) posts = posts.filter((post) => canonRating(post.rating) === injectedRating);
      return { posts, nextCursor: posts.length >= Math.max(1, limit) ? page + 1 : null };
    }

    function parseXmlTags(xml) {
      try {
        return [...new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('tag')]
          .map((node) => Object.fromEntries([...node.attributes].map((attribute) => [attribute.name, attribute.value])));
      } catch { return []; }
    }

    const mapSuggestions = (list, { value = 'name', label = 'name', count = 'count', category = 'type' } = {}) =>
      (Array.isArray(list) ? list : [])
        .filter((t) => t && (t[value] || t[label]))
        .map((t) => ({
          value: String(t[value] || t[label]),
          label: String(t[label] || t[value]),
          count: Number(t[count]) || 0,
          category: String(t[category] ?? '')
        }));

    async function autocompleteWeb({ site, prefix, limit = 10 } = {}) {
      const q = String(prefix || '').trim();
      if (!q || !site?.baseUrl) return [];
      const base = String(site.baseUrl).replace(/\/+$/, '');
      const max = Math.min(Number(limit) || 10, 20);
      try {
        if (site.type === 'danbooru') {
          const params = new URLSearchParams();
          params.set('search[query]', q);
          params.set('search[type]', 'tag_query');
          params.set('limit', String(max));
          const res = await httpGetJSON(`${base}/autocomplete.json?${params}`);
          return mapSuggestions(res, { value: 'value', label: 'label', count: 'post_count', category: 'category' });
        }
        if (site.type === 'moebooru') {
          const params = new URLSearchParams({ name: `${q.replace(/\*+$/, '')}*`, order: 'count', limit: String(max) });
          const res = await httpGetJSON(`${base}/tag.json?${params}`);
          return mapSuggestions(res);
        }
        if (site.type === 'e621') {
          if (q.length < 3) return [];
          const params = new URLSearchParams();
          params.set('search[name_matches]', q);
          params.set('limit', String(max));
          const res = await httpGetJSON(`${base}/tags/autocomplete.json?${params}`);
          return mapSuggestions(res, { value: 'name', label: 'name', count: 'post_count', category: 'category' });
        }
        if (site.type === 'gelbooru') {
          const apiBase = queryDialects.gelbooruApiBase?.(base, site) || base;
          const params = new URLSearchParams({ page: 'dapi', s: 'tag', q: 'index', json: '1', limit: String(max), orderby: 'count' });
          params.set('name_pattern', `${q.replace(/%+/g, '')}%`);
          const user = site?.credentials?.user_id || '';
          const key = site?.credentials?.api_key || '';
          if (user && key) { params.set('user_id', String(user)); params.set('api_key', String(key)); }
          try {
            const json = await httpGetJSON(`${apiBase}/index.php?${params}`);
            const tags = Array.isArray(json) ? json : (Array.isArray(json?.tag) ? json.tag : []);
            if (tags.length) return mapSuggestions(tags);
          } catch {}
          params.delete('json');
          return mapSuggestions(parseXmlTags(await httpGetText(`${apiBase}/index.php?${params}`)));
        }
        if (site.type === 'derpibooru') {
          const params = new URLSearchParams({ q: `${q.replace(/\*+$/, '')}*`, per_page: String(max) });
          const data = await httpGetJSON(`${base}/api/v1/json/search/tags?${params}`);
          return mapSuggestions(data?.tags, { value: 'name', label: 'name', count: 'images', category: 'category' })
            .map((s) => ({ ...s, value: s.value.replace(/\s+/g, '+') }));
        }
      } catch {}
      return [];
    }

    return { buildQueryTags, fetchBooruWeb, autocompleteWeb, normalizeE621, ratingToTag };
  };
})();
