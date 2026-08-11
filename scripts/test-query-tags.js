#!/usr/bin/env node
'use strict';

const { buildQueryTags, ratingToTag } = require('../src/adapters/base');
const {
  gelbooruApiBase,
  queryDialectFor,
  translateGelbooruQuery
} = require('../renderer/js/query-dialect');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

assert(ratingToTag('safe') === 'rating:safe', 'ratingToTag safe');
assert(ratingToTag('any') === '', 'ratingToTag any');

const site = { rating: 'safe', tags: '1girl solo' };
assert(
  buildQueryTags(site, 'cat_ears') === 'rating:safe 1girl solo cat_ears',
  'merges rating, profile tags, and search'
);
assert(
  buildQueryTags({ rating: 'questionable', tags: 'landscape rating:explicit' }, 'order:rank') === 'landscape rating:explicit order:rank',
  'explicit advanced-search ratings override the site default'
);
assert(
  buildQueryTags({ rating: 'safe', tags: '1girl 1girl' }, '1girl cat') === 'rating:safe 1girl cat',
  'dedupes repeated tags'
);
assert(
  translateGelbooruQuery('1girl { blue_hair ~ red_hair } score:>=10 sort:score:desc', {
    type: 'gelbooru', baseUrl: 'https://rule34.xxx'
  }) === '1girl ( blue_hair ~ red_hair ) score:>=10 sort:score:desc',
  'translates Gelbooru OR groups for Rule34.xxx'
);
assert(
  translateGelbooruQuery('1girl {blue_hair~red_hair}', {
    type: 'gelbooru', baseUrl: 'https://custom.example', queryDialect: 'rule34'
  }) === '1girl ( blue_hair ~ red_hair )',
  'supports a Rule34 syntax override for custom Gelbooru forks'
);
assert(
  translateGelbooruQuery('1girl { blue_hair ~ red_hair }', {
    type: 'gelbooru', baseUrl: 'https://gelbooru.com'
  }) === '1girl { blue_hair ~ red_hair }',
  'preserves native Gelbooru advanced syntax'
);
assert(queryDialectFor({ baseUrl: 'https://api.rule34.xxx' }) === 'rule34', 'detects the Rule34 dialect');
assert(gelbooruApiBase('https://rule34.xxx', {}) === 'https://api.rule34.xxx', 'uses the Rule34 API host');

if (process.exitCode) {
  console.error('\nquery tag tests failed');
  process.exit(process.exitCode);
}
console.log('\nAll query tag tests passed');
