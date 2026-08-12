#!/usr/bin/env node
// Checks which booru CDNs actually refuse a hotlinked image, so HOTLINK_HOSTS in
// renderer/js/platform.js only lists the ones that need the media proxy. Everything on
// that list costs the sync server a round trip per thumbnail on web and Android, and a
// CDN that blocks the server's IP breaks those images outright.
//
//   node scripts/test-hotlink-hosts.js
//   node scripts/test-hotlink-hosts.js --referer https://your.deployment/

const REFERER = (() => {
  const i = process.argv.indexOf('--referer');
  return i > -1 ? process.argv[i + 1] : 'https://streambooru.ecchibooru.uk/';
})();

// Several of these refuse anything that does not look like a browser, so the sample
// fetch borrows the same user agent as the image fetch.
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

async function getText(url, accept) {
  const r = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: accept }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`sample API ${r.status}`);
  return r.text();
}

async function getJson(url) {
  const body = await getText(url, 'application/json');
  try { return JSON.parse(body); } catch { throw new Error('sample API did not return JSON'); }
}

// Gelbooru-style boorus answer the same dapi query but disagree on whether they wrap
// the array in a "post" key, and the older forks ignore json=1 and reply with XML.
async function gelbooruSample(base) {
  try {
    const j = await getJson(`${base}/index.php?page=dapi&s=post&q=index&json=1&limit=1`);
    const post = Array.isArray(j) ? j[0] : (j?.post?.[0] || j?.post);
    if (post) return postUrl(base, post);
  } catch (e) {
    if (/^sample API \d/.test(String(e?.message))) throw e;
  }
  const xml = await getText(`${base}/index.php?page=dapi&s=post&q=index&limit=1`, 'application/xml');
  const attr = (name) => (new RegExp(`${name}="([^"]+)"`).exec(xml) || [])[1];
  const post = { preview_url: attr('preview_url'), directory: attr('directory'), image: attr('image') };
  if (!post.preview_url && !post.image) throw new Error('no posts returned');
  return postUrl(base, post);
}

function postUrl(base, post) {
  if (post.preview_url) return post.preview_url.startsWith('//') ? `https:${post.preview_url}` : post.preview_url;
  if (post.directory && post.image) return `${base}/thumbnails/${post.directory}/thumbnail_${String(post.image).replace(/\.[^.]+$/, '.jpg')}`;
  throw new Error('no preview url in response');
}

async function moebooruSample(base) {
  const j = await getJson(`${base}/post.json?limit=1`);
  const url = j?.[0]?.preview_url;
  if (!url) throw new Error('no preview url in response');
  return url.startsWith('//') ? `https:${url}` : url;
}

async function e621Sample(base) {
  const j = await getJson(`${base}/posts.json?limit=1`);
  const url = j?.posts?.[0]?.preview?.url || j?.posts?.[0]?.file?.url;
  if (!url) throw new Error('no preview url (login may be required)');
  return url;
}

const TARGETS = [
  { host: 'donmai.us', sample: async () => {
    const j = await getJson('https://danbooru.donmai.us/posts.json?limit=1');
    const url = j?.[0]?.preview_file_url || j?.[0]?.file_url;
    if (!url) throw new Error('no preview url in response');
    return url;
  } },
  { host: 'yande.re', sample: () => moebooruSample('https://yande.re') },
  { host: 'konachan.com', sample: () => moebooruSample('https://konachan.com') },
  { host: 'konachan.net', sample: () => moebooruSample('https://konachan.net') },
  { host: 'e621.net', sample: () => e621Sample('https://e621.net') },
  { host: 'e926.net', sample: () => e621Sample('https://e926.net') },
  { host: 'derpibooru.org', sample: async () => {
    const j = await getJson('https://derpibooru.org/api/v1/json/search/images?q=*&per_page=1');
    const url = j?.images?.[0]?.representations?.thumb;
    if (!url) throw new Error('no thumb in response');
    return url.startsWith('//') ? `https:${url}` : url;
  } },
  { host: 'gelbooru.com', sample: () => gelbooruSample('https://gelbooru.com') },
  { host: 'safebooru.org', sample: () => gelbooruSample('https://safebooru.org') },
  { host: 'rule34.xxx', sample: () => gelbooruSample('https://rule34.xxx') },
  { host: 'realbooru.com', sample: () => gelbooruSample('https://realbooru.com') },
  { host: 'xbooru.com', sample: () => gelbooruSample('https://xbooru.com') },
  { host: 'tbib.org', sample: () => gelbooruSample('https://tbib.org') },
  { host: 'hypnohub.net', sample: () => gelbooruSample('https://hypnohub.net') }
];

// Ask for the first kilobyte only: we want the verdict, not the picture.
async function fetchStatus(url, extra) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        Range: 'bytes=0-1023',
        ...extra
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000)
    });
    try { await r.body?.cancel(); } catch {}
    return r.status;
  } catch (e) {
    return `ERR ${e?.name === 'TimeoutError' ? 'timeout' : String(e?.message || e).slice(0, 40)}`;
  }
}

const ok = (s) => s === 200 || s === 206 || s === 304;

(async () => {
  console.log(`Hotlink audit — embedding as ${REFERER}\n`);
  const needsProxy = [];
  const noProxy = [];
  const unknown = [];

  for (const target of TARGETS) {
    let url;
    try {
      url = await target.sample();
    } catch (e) {
      unknown.push(target.host);
      console.log(`${target.host.padEnd(16)} no sample (${String(e?.message || e).slice(0, 48)})`);
      continue;
    }

    const bare = await fetchStatus(url, {});
    const embedded = await fetchStatus(url, {
      Referer: REFERER,
      'Sec-Fetch-Dest': 'image',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'cross-site'
    });

    let verdict;
    if (ok(embedded)) { verdict = 'no protection — proxy not needed'; noProxy.push(target.host); }
    else if (ok(bare)) { verdict = 'HOTLINK PROTECTED — keep proxying'; needsProxy.push(target.host); }
    else { verdict = 'unreachable either way'; unknown.push(target.host); }

    const cdn = new URL(url).hostname;
    console.log(`${target.host.padEnd(16)} bare=${String(bare).padEnd(6)} embedded=${String(embedded).padEnd(6)} ${verdict}  [${cdn}]`);
  }

  console.log(`\nneeds the proxy: ${needsProxy.join(', ') || '(none)'}`);
  console.log(`serves directly: ${noProxy.join(', ') || '(none)'}`);
  if (unknown.length) console.log(`inconclusive:    ${unknown.join(', ')}`);
})();
