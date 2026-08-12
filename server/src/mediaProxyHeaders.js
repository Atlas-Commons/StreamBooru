'use strict';

const { refererHeadersFor, BOORU_UA } = require('./refererFor');

const RESPONSE_HEADERS = [
  'accept-ranges',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified'
];

function buildMediaRequestHeaders({ url, accept = '', ref = '', range = '' } = {}) {
  return {
    'User-Agent': BOORU_UA,
    Accept: accept || 'image/avif,image/webp,image/apng,image/*,video/*,application/octet-stream,*/*;q=0.8',
    ...refererHeadersFor(url, ref),
    ...(range ? { Range: range } : {})
  };
}

function sanitizeDownloadName(filename) {
  return String(filename || 'download')
    .replace(/[<>:"/\\|?*\x00-\x1F\x7F]+/g, '_')
    .slice(0, 200) || 'download';
}

function contentDisposition(filename) {
  const safeName = sanitizeDownloadName(filename);
  const asciiName = safeName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

function applyMediaResponseHeaders(res, upstream, { download = false, filename = '' } = {}) {
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  if (!upstream.headers.get('content-type')) {
    res.setHeader('Content-Type', 'application/octet-stream');
  }
  // Booru media paths are content addressed — the bytes behind a hash never change — so
  // a shared cache can hold them far longer than a browser needs to, and neither has any
  // reason to revalidate. Every hit served from a CDN edge is a hit the source site and
  // this server both avoid.
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, immutable');
  if (download) res.setHeader('Content-Disposition', contentDisposition(filename));
}

module.exports = {
  RESPONSE_HEADERS,
  applyMediaResponseHeaders,
  buildMediaRequestHeaders,
  contentDisposition,
  sanitizeDownloadName
};
