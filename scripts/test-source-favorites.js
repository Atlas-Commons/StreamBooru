#!/usr/bin/env node
'use strict';

/* Each booru engine names the "posts this account faved" search differently, and getting it
   wrong fails quietly: the site answers 200 with an empty list, and a sync that pulls nothing
   looks exactly like an account with no favourites. Pin the query each adapter builds.

   Run with --live to also pull page one from every credentialled site in the local config. */

const Danbooru = require('../src/adapters/danbooru');
const Moebooru = require('../src/adapters/moebooru');
const E621 = require('../src/adapters/e621');

let failures = 0;
function assert(cond, msg) {
  if (cond) return console.log('ok:', msg);
  console.error('FAIL:', msg);
  failures++;
}

// Adapter wired to a fetcher that records the URL instead of calling out.
function spy(Adapter, empty) {
  const calls = [];
  const get = async (url) => { calls.push(url); return empty; };
  return { adapter: new Adapter(get, async () => ({}), async () => ({})), calls };
}
const query = (url, key) => new URL(url).searchParams.get(key);

(async () => {
  const danbooru = spy(Danbooru, []);
  await danbooru.adapter.listFavorites(
    { baseUrl: 'https://danbooru.donmai.us', type: 'danbooru', credentials: { login: 'me', api_key: 'k' } },
    { page: 2, limit: 200 }
  );
  assert(query(danbooru.calls[0], 'tags') === 'ordfav:me', 'danbooru asks for ordfav:<login>');
  assert(query(danbooru.calls[0], 'login') === 'me' && query(danbooru.calls[0], 'api_key') === 'k',
    'danbooru sends credentials');
  assert(query(danbooru.calls[0], 'page') === '2', 'danbooru pages');

  const e621 = spy(E621, { posts: [] });
  await e621.adapter.listFavorites(
    { baseUrl: 'https://e621.net', type: 'e621', credentials: { login: 'me', api_key: 'k' } },
    { page: 1, limit: 500 }
  );
  assert(query(e621.calls[0], 'tags') === 'fav:me', 'e621 asks for fav:<login>');
  assert(query(e621.calls[0], 'limit') === '320', 'e621 clamps limit to its maximum of 320');

  const moebooru = spy(Moebooru, []);
  await moebooru.adapter.listFavorites(
    { baseUrl: 'https://yande.re', type: 'moebooru', credentials: { login: 'me', password_hash: 'h' } },
    { page: 1, limit: 100 }
  );
  assert(query(moebooru.calls[0], 'tags') === 'vote:3:me', 'moebooru asks for vote:3:<login>');

  // A sync reads absence from this listing as an unfave, so a post the site has hidden since
  // it was faved must still come back — filtering it out would delete it from local faves.
  const banned = spy(Danbooru, [{ id: 7, is_banned: true, tag_string: 'a' }]);
  const bannedList = await banned.adapter.listFavorites(
    { baseUrl: 'https://danbooru.donmai.us', type: 'danbooru', credentials: { login: 'me', api_key: 'k' } }, {}
  );
  assert(bannedList.posts.length === 1, 'danbooru keeps banned posts in the favourites listing');

  const deleted = spy(E621, { posts: [{ id: 7, flags: { deleted: true }, file: {}, tags: {} }] });
  const deletedList = await deleted.adapter.listFavorites(
    { baseUrl: 'https://e621.net', type: 'e621', credentials: { login: 'me', api_key: 'k' } }, {}
  );
  assert(deletedList.posts.length === 1, 'e621 keeps deleted posts in the favourites listing');

  // Without credentials the sync must fail loudly rather than report an empty account.
  for (const [name, Adapter, site] of [
    ['danbooru', Danbooru, { baseUrl: 'https://danbooru.donmai.us', credentials: { login: 'me' } }],
    ['e621', E621, { baseUrl: 'https://e621.net', credentials: {} }],
    ['moebooru', Moebooru, { baseUrl: 'https://yande.re', credentials: { login: 'me' } }]
  ]) {
    let threw = false;
    try { await spy(Adapter, []).adapter.listFavorites(site, {}); } catch { threw = true; }
    assert(threw, `${name} refuses to list favourites without credentials`);
  }

  reconcileTests();
  if (process.argv.includes('--live')) await live();

  console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
  process.exitCode = failures ? 1 : 0;
})();

function reconcileTests() {
  const { reconcileSourceFavorites } = require('../src/favoriteMerge');
  const base = 'https://danbooru.donmai.us';
  const post = (id) => ({ id, site: { baseUrl: base, type: 'danbooru' } });
  const fave = (id, added_at) => ({ key: `${base}#${id}`, added_at, post: post(id) });
  const run = (over) => reconcileSourceFavorites({
    remote: new Map(), local: [], previousKeys: new Set(), pulledAt: 0, siteBase: base, now: 500, ...over
  });

  let r = run({ remote: new Map([[`${base}#1`, post(1)]]) });
  assert(r.toAdd.length === 1 && r.toAdd[0].key === `${base}#1`, 'a fave only on the site is added here');
  assert(r.toAdd[0].post.user_favorited === true, 'a pulled fave is marked as faved on the source');

  r = run({ remote: new Map([[`${base}#1`, post(1)]]), local: [fave(1, 10)] });
  assert(r.toAdd.length === 0 && r.toRemove.length === 0 && r.toPush.length === 0, 'a fave on both sides is left alone');

  // Never seen on the site, so it is ours to send up rather than a removal to honour.
  r = run({ local: [fave(1, 10)] });
  assert(r.toPush.length === 1 && r.toRemove.length === 0, 'a fave the site has never had is pushed up');

  // Present at the last pull, gone now, and untouched here since: the site removed it. The
  // account keeps another fave throughout, so the listing is a believable one.
  const stillThere = new Map([[`${base}#9`, post(9)]]);
  const seenBoth = () => new Set([`${base}#1`, `${base}#9`]);
  r = run({ remote: stillThere, local: [fave(1, 10), fave(9, 10)], previousKeys: seenBoth(), pulledAt: 100 });
  assert(r.toRemove.length === 1 && r.toRemove[0] === `${base}#1` && r.toPush.length === 0,
    'a fave dropped on the site is removed here');

  // Same, but re-faved here after that pull, so ours is the newer fact.
  r = run({ remote: stillThere, local: [fave(1, 200), fave(9, 10)], previousKeys: seenBoth(), pulledAt: 100 });
  assert(r.toPush.length === 1 && r.toRemove.length === 0, 'a fave remade here after the last pull wins');

  r = run({ local: [fave(1, 10)], previousKeys: new Set([`${base}#1`]), pulledAt: 100, truncated: true });
  assert(r.toRemove.length === 0 && r.toPush.length === 0, 'a truncated listing never judges a fave missing');

  // An account that had favourites last pull and reports none now is a broken credential or
  // a changed API far more often than someone who unfaved everything.
  r = run({ local: [fave(1, 10), fave(2, 20)], previousKeys: new Set([`${base}#1`, `${base}#2`]), pulledAt: 100 });
  assert(r.toRemove.length === 0 && r.toPush.length === 0, 'an empty listing never wipes the local set');

  const other = 'https://yande.re';
  r = run({ local: [{ key: `${other}#1`, added_at: 10, post: { id: 1, site: { baseUrl: other } } }] });
  assert(r.toRemove.length === 0 && r.toPush.length === 0, "another site's faves are untouched");

  // First run has no snapshot, so it must not delete anything.
  r = run({ local: [fave(1, 10), fave(2, 20)], remote: new Map([[`${base}#3`, post(3)]]) });
  assert(r.toRemove.length === 0 && r.toAdd.length === 1 && r.toPush.length === 2,
    'the first sync only ever adds, in both directions');
}

async function live() {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const configPath = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'streambooru', 'config.json');
  if (!fs.existsSync(configPath)) return console.log('\nlive: no local config, skipping');

  const httpGetJson = async (url, headers = {}) => {
    const res = await fetch(url, { headers: { 'User-Agent': 'StreamBooru/dev (favourites test)', ...headers } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  const adapters = {
    danbooru: new Danbooru(httpGetJson, async () => ({}), async () => ({})),
    moebooru: new Moebooru(httpGetJson, async () => ({})),
    e621: new E621(httpGetJson, async () => ({}), async () => ({}))
  };

  console.log('\nlive pull (page 1):');
  const { sites = [] } = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  for (const site of sites) {
    const adapter = adapters[site.type];
    if (!adapter) continue;
    try {
      const { posts } = await adapter.listFavorites(site, { page: 1, limit: 5 });
      console.log(`  ${site.name || site.type}: ${posts.length} favourite(s)`,
        posts.length ? `— first id ${posts[0].id}` : '');
    } catch (e) {
      console.log(`  ${site.name || site.type}: ${String(e.message || e)}`);
    }
  }
}
