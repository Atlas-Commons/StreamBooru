'use strict';

async function fetchWithAllowedRedirects(url, options = {}, isAllowed, maxRedirects = 5) {
  let current = new URL(String(url));
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    if (!isAllowed(current.toString())) {
      const error = new Error('Proxy redirect target is not allowed');
      error.code = 'PROXY_TARGET_DENIED';
      throw error;
    }
    const response = await fetch(current, { ...options, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    try { await response.body?.cancel(); } catch {}
    current = new URL(location, current);
  }
  const error = new Error('Too many proxy redirects');
  error.code = 'PROXY_REDIRECT_LIMIT';
  throw error;
}

async function readResponseBufferWithLimit(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw Object.assign(new Error('Upstream response is too large'), { code: 'PROXY_BODY_LIMIT' });
  if (!response.body) {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maxBytes) throw Object.assign(new Error('Upstream response is too large'), { code: 'PROXY_BODY_LIMIT' });
    return body;
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      try { await response.body.cancel(); } catch {}
      throw Object.assign(new Error('Upstream response is too large'), { code: 'PROXY_BODY_LIMIT' });
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes);
}

module.exports = { fetchWithAllowedRedirects, readResponseBufferWithLimit };
