'use strict';

/* Reconcile one source site's favourites with ours.

   A booru reports which posts an account has faved; none of them report when a fave was
   dropped. So the only timestamp available for a removal is the window it happened in: a key
   the previous pull saw and this one does not was dropped somewhere between the two. Compare
   that against when the fave was made here and the newer fact wins — a fave made after the
   last pull goes up to the site, an older one loses to the site's removal.

   Favourite keys are `<normalized base url>#<post id>`, so a key's prefix decides which site
   owns it without needing to re-parse the post. */
function reconcileSourceFavorites({
  remote,            // Map of key -> normalized post, the site's current favourites
  local,             // [{ key, added_at, post }] every local favourite, all sites
  previousKeys,      // Set of keys this site reported at the previous pull
  pulledAt = 0,      // when that previous pull ran, 0 if there has not been one
  siteBase,          // normalized base url of the site being reconciled
  truncated = false, // the listing hit its cap, so absence proves nothing
  now = Date.now()
} = {}) {
  const localByKey = new Map((local || []).map((it) => [it.key, it]));
  const prefix = `${siteBase}#`;
  const toAdd = [];
  const toRemove = [];
  const toPush = [];

  for (const [key, post] of remote) {
    if (localByKey.has(key)) continue;
    toAdd.push({ key, added_at: now, post: { ...post, user_favorited: true } });
  }

  // A truncated listing cannot tell a dropped favourite from one past the cap, so nothing
  // this site owns can be judged missing. An empty one is treated the same way: an account
  // that reported favourites last time and none now is far more likely to be a changed API
  // or a rejected credential than someone who unfaved everything, and the cost of being
  // wrong is the whole local set.
  const unreliable = truncated || (remote.size === 0 && (previousKeys?.size || 0) > 0);
  if (!unreliable) {
    for (const it of localByKey.values()) {
      if (!it?.key || !it.key.startsWith(prefix) || remote.has(it.key)) continue;
      const seenBefore = previousKeys?.has(it.key);
      if (seenBefore && (Number(it.added_at) || 0) <= pulledAt) toRemove.push(it.key);
      else toPush.push(it);
    }
  }

  return { toAdd, toRemove, toPush };
}

module.exports = { reconcileSourceFavorites };
