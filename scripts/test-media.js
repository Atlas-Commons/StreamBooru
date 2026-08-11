#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const E621Adapter = require('../src/adapters/e621');
const { isVideoUrl } = require('../src/adapters/base');
const {
  applyMediaResponseHeaders,
  buildMediaRequestHeaders,
  contentDisposition
} = require('../server/src/mediaProxyHeaders');
const { isProxyAllowed, refererFor } = require('../src/shared/refererFor');
const { fetchWithAllowedRedirects, readResponseBufferWithLimit } = require('../server/src/proxyFetch');

async function main() {
  assert.equal(isVideoUrl('https://static1.e621.net/data/aa/bb/example.webm?download=1'), true);
  assert.equal(isVideoUrl('https://static1.e621.net/data/aa/bb/example.jpg'), false);
  assert.equal(isProxyAllowed('https://static1.e621.net/data/example.webm'), true);
  assert.equal(isProxyAllowed('https://e621.net.attacker.example/data/example.webm'), false);
  assert.equal(refererFor('https://e621.net.attacker.example/data/example.webm'), '');

  const originalFetch = global.fetch;
  global.fetch = async () => new Response(null, {
    status: 302,
    headers: { location: 'https://e621.net.attacker.example/redirected.webm' }
  });
  await assert.rejects(
    fetchWithAllowedRedirects('https://e621.net/start.webm', {}, isProxyAllowed),
    (error) => error?.code === 'PROXY_TARGET_DENIED'
  );
  global.fetch = originalFetch;
  await assert.rejects(
    readResponseBufferWithLimit(new Response(Buffer.alloc(5)), 4),
    (error) => error?.code === 'PROXY_BODY_LIMIT'
  );

  let requestedUrl = '';
  const adapter = new E621Adapter(async (url) => {
    requestedUrl = url;
    return {
      posts: [{
        id: 123,
        created_at: '2026-08-11T00:00:00Z',
        score: { total: 7 },
        fav_count: 4,
        rating: 's',
        tags: { general: ['animated'] },
        flags: { deleted: false },
        file: {
          ext: 'webm',
          url: 'https://static1.e621.net/data/aa/bb/example.webm',
          width: 1280,
          height: 720
        },
        sample: { url: 'https://static1.e621.net/data/sample/example.webm' },
        preview: { url: 'https://static1.e621.net/data/preview/example.jpg' },
        sources: []
      }]
    };
  });
  const result = await adapter.fetchNew({
    name: 'e621',
    type: 'e621',
    baseUrl: 'https://e621.net',
    rating: 'safe',
    credentials: { login: 'tester', api_key: 'secret' }
  }, { limit: 20, search: 'animated' });

  const parsed = new URL(requestedUrl);
  assert.equal(parsed.searchParams.get('login'), 'tester');
  assert.equal(parsed.searchParams.get('api_key'), 'secret');
  assert.match(parsed.searchParams.get('tags'), /rating:s/);
  assert.equal(result.posts[0].is_video, true);
  assert.match(result.posts[0].file_url, /\.webm$/);

  const requestHeaders = buildMediaRequestHeaders({
    url: 'https://static1.e621.net/data/aa/bb/example.webm',
    range: 'bytes=0-1023'
  });
  assert.equal(requestHeaders.Range, 'bytes=0-1023');
  assert.equal(requestHeaders.Referer, 'https://e621.net');

  const captured = new Map();
  const fakeResponse = { setHeader: (name, value) => captured.set(name.toLowerCase(), value) };
  const upstream = {
    headers: new Headers({
      'accept-ranges': 'bytes',
      'content-length': '1024',
      'content-range': 'bytes 0-1023/4096',
      'content-type': 'video/webm'
    })
  };
  applyMediaResponseHeaders(fakeResponse, upstream, { download: true, filename: 'clip.webm' });
  assert.equal(captured.get('accept-ranges'), 'bytes');
  assert.equal(captured.get('content-range'), 'bytes 0-1023/4096');
  assert.equal(captured.get('content-type'), 'video/webm');
  assert.match(captured.get('content-disposition'), /^attachment;/);
  assert.doesNotThrow(() => contentDisposition('unicode-狐.webm'));

  global.window = {};
  require('../renderer/js/query-dialect');
  require('../renderer/js/booru-client');
  let browserRequest = '';
  const browserClient = global.window.createBooruClient({
    httpGetText: async () => '',
    isVideoMediaUrl: (url) => /\.webm(?:\?|$)/i.test(url),
    httpGetJSON: async (url) => {
      browserRequest = url;
      return {
        posts: [{
          id: 456, score: { total: 9 }, fav_count: 2, rating: 's', created_at: '2026-08-11T00:00:00Z',
          tags: { general: ['animated'] }, flags: { deleted: false },
          file: { ext: 'webm', url: 'https://static1.e621.net/data/browser.webm', width: 640, height: 480 },
          sample: {}, preview: { url: 'https://static1.e621.net/data/browser.jpg' }
        }]
      };
    }
  });
  const browserResult = await browserClient.fetchBooruWeb({
    site: { type: 'e621', baseUrl: 'https://e621.net', rating: 'safe', credentials: { login: 'browser-user', api_key: 'browser-key' } },
    viewType: 'new', limit: 20
  });
  const browserUrl = new URL(browserRequest);
  assert.equal(browserUrl.searchParams.get('login'), 'browser-user');
  assert.equal(browserUrl.searchParams.get('api_key'), 'browser-key');
  assert.equal(browserResult.posts[0].is_video, true);

  let rule34Request = '';
  const rule34Client = global.window.createBooruClient({
    httpGetText: async () => '',
    isVideoMediaUrl: () => false,
    httpGetJSON: async (url) => {
      rule34Request = url;
      return [{ id: 789, tags: 'blue_hair', file_url: 'https://api.rule34.xxx/images/example.jpg' }];
    }
  });
  const rule34Result = await rule34Client.fetchBooruWeb({
    site: { type: 'gelbooru', baseUrl: 'https://rule34.xxx', rating: 'any', credentials: {} },
    viewType: 'search', limit: 20, search: '1girl { blue_hair ~ red_hair }'
  });
  const rule34Url = new URL(rule34Request);
  assert.equal(rule34Url.hostname, 'api.rule34.xxx');
  assert.equal(rule34Url.searchParams.get('tags'), '1girl ( blue_hair ~ red_hair )');
  assert.equal(rule34Result.posts[0].sample_url, rule34Result.posts[0].file_url);

  const danbooruClient = global.window.createBooruClient({
    httpGetText: async () => '',
    isVideoMediaUrl: () => false,
    httpGetJSON: async () => [{
      id: 790, rating: 's', tag_string: 'sharp_preview',
      preview_file_url: 'https://cdn.donmai.us/preview.jpg',
      file_url: 'https://cdn.donmai.us/original.jpg'
    }]
  });
  const danbooruResult = await danbooruClient.fetchBooruWeb({
    site: { type: 'danbooru', baseUrl: 'https://danbooru.donmai.us', rating: 'safe' },
    viewType: 'new', limit: 1
  });
  assert.equal(danbooruResult.posts[0].sample_url, 'https://cdn.donmai.us/original.jpg');
  delete global.window;

  console.log('All media tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
