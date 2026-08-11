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
