'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

function createNetworkClient({ net, refererHeadersFor, userAgent, isDev = false }) {
  function applyDefaultHeaders(request, url, headers = {}) {
    const h = {
      'User-Agent': userAgent,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      ...refererHeadersFor(url),
      ...headers
    };
    Object.entries(h).forEach(([key, value]) => {
      if (value != null && value !== '') request.setHeader(key, value);
    });
  }

  function requestText(url, { method = 'GET', headers = {}, body = '' } = {}) {
    return new Promise((resolve, reject) => {
      const request = net.request({ url, method });
      applyDefaultHeaders(request, url, headers);
      let data = '';
      request.on('response', (response) => {
        const status = response.statusCode || 0;
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => resolve({ status, data }));
      });
      request.on('error', reject);
      if (body) request.write(body);
      request.end();
    });
  }

  async function httpGetJson(url, headers = {}) {
    if (isDev) console.log('[GET]', new URL(url).origin + new URL(url).pathname);
    const result = await requestText(url, { headers: { Accept: 'application/json', ...headers } });
    if (result.status >= 400) throw new Error(`HTTP ${result.status} from ${new URL(url).origin}${new URL(url).pathname}`);
    return JSON.parse(result.data);
  }

  async function httpPostForm(url, form, headers = {}) {
    if (isDev) console.log('[POST-FORM]', new URL(url).origin + new URL(url).pathname);
    const body = new URLSearchParams(form || {}).toString();
    const result = await requestText(url, {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers }
    });
    if (result.status >= 400) throw new Error(`HTTP ${result.status} from ${new URL(url).origin}${new URL(url).pathname}`);
    try { return JSON.parse(result.data); } catch { return { ok: true, raw: result.data }; }
  }

  async function requestJsonResult(method, url, json, headers = {}) {
    if (isDev) console.log(`[${method}-JSON]`, new URL(url).origin + new URL(url).pathname);
    try {
      const result = await requestText(url, {
        method,
        body: json == null ? '' : JSON.stringify(json),
        headers: {
          ...(json == null ? {} : { 'Content-Type': 'application/json' }),
          Accept: 'application/json',
          ...headers
        }
      });
      try { return { status: result.status, json: JSON.parse(result.data) }; }
      catch { return { status: result.status, json: null }; }
    } catch {
      return { status: 0, json: null };
    }
  }

  const httpPostJson = (url, json, headers = {}) => requestJsonResult('POST', url, json, headers);
  const httpPutJson = (url, json, headers = {}) => requestJsonResult('PUT', url, json, headers);
  const httpDelete = (url, headers = {}) => requestJsonResult('DELETE', url, null, headers);

  async function downloadUrlToFile(url, outPath) {
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    try {
      await new Promise((resolve, reject) => {
        const request = net.request({ url, method: 'GET', redirect: 'follow' });
        applyDefaultHeaders(request, url);
        request.on('response', (response) => {
          const status = response.statusCode || 0;
          if (status < 200 || status >= 300) {
            response.resume?.();
            reject(new Error(`HTTP ${status} from ${new URL(url).origin}${new URL(url).pathname}`));
            return;
          }
          pipeline(response, fs.createWriteStream(outPath)).then(resolve, reject);
        });
        request.on('error', reject);
        request.end();
      });
    } catch (error) {
      await fs.promises.unlink(outPath).catch(() => {});
      throw error;
    }
  }

  return {
    applyDefaultHeaders,
    downloadUrlToFile,
    httpDelete,
    httpGetJson,
    httpPostForm,
    httpPostJson,
    httpPutJson
  };
}

module.exports = { createNetworkClient };
