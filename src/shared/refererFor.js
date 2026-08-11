/**
 * Shared Referer/Origin helpers for booru CDN hotlink requirements.
 */
const ALLOWED_HOSTS = [
  "donmai.us", "yande.re", "konachan.com", "konachan.net",
  "e621.net", "e926.net", "e621.media", "e926.media",
  "derpibooru.org", "derpicdn.net", "gelbooru.com", "safebooru.org",
  "rule34.xxx", "realbooru.com", "xbooru.com", "tbib.org", "hypnohub.net"
];

function hostMatches(hostname, domain) {
  const h = String(hostname || "").toLowerCase().replace(/\.$/, "");
  const d = String(domain || "").toLowerCase().replace(/\.$/, "");
  return !!h && !!d && (h === d || h.endsWith(`.${d}`));
}

function hostAllowed(hostname) {
  return ALLOWED_HOSTS.some((domain) => hostMatches(hostname, domain));
}

function isBooruHostAllowed(url) {
  try {
    const u = new URL(url);
    const okProto = u.protocol === "https:" || u.protocol === "http:";
    return okProto && hostAllowed(u.hostname);
  } catch {
    return false;
  }
}

function isProxyAllowed(url) {
  return isBooruHostAllowed(url);
}

function refererFor(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (hostMatches(h, "donmai.us")) return "https://danbooru.donmai.us";
    if (hostMatches(h, "yande.re")) return "https://yande.re";
    if (hostMatches(h, "konachan.com")) return "https://konachan.com";
    if (hostMatches(h, "konachan.net")) return "https://konachan.net";
    if (hostMatches(h, "hypnohub.net")) return "https://hypnohub.net";
    if (hostMatches(h, "tbib.org")) return "https://tbib.org";
    if (hostMatches(h, "gelbooru.com")) return "https://gelbooru.com";
    if (hostMatches(h, "safebooru.org")) return "https://safebooru.org";
    if (hostMatches(h, "rule34.xxx")) return "https://rule34.xxx";
    if (hostMatches(h, "realbooru.com")) return "https://realbooru.com";
    if (hostMatches(h, "xbooru.com")) return "https://xbooru.com";
    if (hostMatches(h, "e621.net") || hostMatches(h, "e621.media")) return "https://e621.net";
    if (hostMatches(h, "e926.net") || hostMatches(h, "e926.media")) return "https://e926.net";
    if (hostMatches(h, "derpicdn.net") || hostMatches(h, "derpibooru.org")) return "https://derpibooru.org";
    return "";
  } catch {
    return "";
  }
}

function refererHeadersFor(url, refOverride = "") {
  let refFinal = "";
  if (refOverride) {
    try {
      const u = new URL(refOverride);
      if (hostAllowed(u.hostname)) refFinal = u.toString();
    } catch {
      /* ignore */
    }
  }
  if (!refFinal) refFinal = refererFor(url);

  const hdr = {};
  if (refFinal) {
    try {
      const o = new URL(refFinal);
      hdr.Referer = refFinal;
      hdr.Origin = `${o.protocol}//${o.host}`;
    } catch {
      hdr.Referer = refFinal;
    }
  }
  return hdr;
}

const BOORU_UA =
  "Mozilla/5.0 StreamBooru/1.1 (+https://github.com/Atlas-Commons/StreamBooru)";

module.exports = {
  ALLOWED_HOSTS,
  hostAllowed,
  hostMatches,
  isBooruHostAllowed,
  isProxyAllowed,
  refererFor,
  refererHeadersFor,
  BOORU_UA
};
