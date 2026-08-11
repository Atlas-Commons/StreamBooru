(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StreamBooruQueryDialect = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const DIALECTS = new Set(['auto', 'gelbooru', 'rule34']);

  function hostnameFrom(value) {
    try { return new URL(String(value || '')).hostname.toLowerCase().replace(/\.$/, ''); }
    catch { return ''; }
  }

  function hostMatches(hostname, domain) {
    return hostname === domain || hostname.endsWith(`.${domain}`);
  }

  function queryDialectFor(site = {}) {
    const configured = String(site.queryDialect || site.query_dialect || 'auto').toLowerCase();
    if (configured !== 'auto' && DIALECTS.has(configured)) return configured;
    const hostname = hostnameFrom(site.baseUrl || site.base_url || '');
    return hostMatches(hostname, 'rule34.xxx') ? 'rule34' : 'gelbooru';
  }

  function translateGelbooruOrGroups(query) {
    return String(query || '').replace(/\{([^{}]*~[^{}]*)\}/g, (_match, content) => {
      const alternatives = content.trim().replace(/\s*~\s*/g, ' ~ ');
      return `( ${alternatives} )`;
    }).replace(/\s+/g, ' ').trim();
  }

  function translateGelbooruQuery(query, site = {}) {
    const value = String(query || '').trim();
    if (!value || queryDialectFor(site) === 'gelbooru') return value;
    return translateGelbooruOrGroups(value);
  }

  function gelbooruApiBase(baseUrl, site = {}) {
    const value = String(baseUrl || '').replace(/\/+$/, '');
    if (queryDialectFor({ ...site, baseUrl: value }) !== 'rule34') return value;
    try {
      const url = new URL(value);
      if (hostMatches(url.hostname.toLowerCase(), 'rule34.xxx')) {
        url.hostname = 'api.rule34.xxx';
        url.pathname = '';
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/+$/, '');
      }
    } catch {}
    return value;
  }

  return {
    DIALECTS,
    gelbooruApiBase,
    queryDialectFor,
    translateGelbooruOrGroups,
    translateGelbooruQuery
  };
});
