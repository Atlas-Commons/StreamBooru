#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'streambooru-local-test-secret';
process.env.ENC_SECRET = process.env.ENC_SECRET || 'streambooru-local-test-encryption-secret';

async function main() {
  const { sanitizeSiteInput } = require('../server/src/sanitize');
  assert.equal(sanitizeSiteInput({ type: 'gelbooru', baseUrl: 'https://custom.example', queryDialect: 'rule34' }).query_dialect, 'rule34');
  assert.equal(sanitizeSiteInput({ type: 'gelbooru', baseUrl: 'https://custom.example', queryDialect: 'invalid' }).query_dialect, 'auto');

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  const { app } = require('../server/src/index');
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    let response = await fetch(`${base}/imgproxy?url=${encodeURIComponent('https://fakee621.net/a.jpg?api_key=secret-value')}`);
    assert.equal(response.status, 400);
    assert.ok(response.headers.get('ratelimit-limit'));

    response = await fetch(`${base}/api/booru/fetch?url=${encodeURIComponent('https://e621.net.evil.example/posts.json?api_key=secret-value')}`);
    assert.equal(response.status, 400);

    response = await fetch(`${base}/api/me`);
    assert.equal(response.status, 401);

    assert.equal(logs.some((line) => line.includes('secret-value') || line.includes('api_key')), false);

    const { clampPost } = require('../server/src/sanitize');
    const clamped = clampPost({
      id: '1', tags: ['a'], artist: ['b'], copyright: ['c'], character: ['d'],
      is_video: true, grid_video_url: 'https://example.test/v.mp4', unknown_field: 'dropped'
    });
    assert.deepEqual(clamped.artist, ['b']);
    assert.deepEqual(clamped.copyright, ['c']);
    assert.deepEqual(clamped.character, ['d']);
    assert.equal(clamped.is_video, true);
    assert.equal(clamped.grid_video_url, 'https://example.test/v.mp4');
    assert.equal(clamped.unknown_field, undefined);

    response = await fetch(`${base}/api/stream/ticket`, { method: 'POST' });
    assert.equal(response.status, 401);

    const jwt = require(require.resolve('jsonwebtoken', { paths: [require('node:path').join(__dirname, '..', 'server')] }));
    const accountToken = jwt.sign({ sub: 'test-user' }, process.env.JWT_SECRET, { expiresIn: '5m' });
    response = await fetch(`${base}/api/stream/ticket`, { method: 'POST', headers: { Authorization: `Bearer ${accountToken}` } });
    assert.equal(response.status, 200);
    const ticket = (await response.json()).ticket;
    assert.ok(ticket);

    // a stream ticket travels in a URL, so it must not open the rest of the API
    response = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${ticket}` } });
    assert.equal(response.status, 401);

    // and the account token is not a ticket
    response = await fetch(`${base}/api/stream?ticket=${encodeURIComponent(accountToken)}`);
    assert.equal(response.status, 401);

    originalLog('All local server tests passed');
  } finally {
    console.log = originalLog;
    await new Promise((resolve) => server.close(resolve));
    const { pool } = require('../server/src/db');
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
