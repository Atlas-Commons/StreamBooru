(() => {
  const openExternal = (url) => { if (url) window.api.openExternal(url); };

  const isElectron = () => !!(window.Platform?.isElectron?.());
  const isAndroid = () => !!(window.Platform?.isAndroid?.());
  const isWebBrowser = () => !isElectron() && !isAndroid();
  const isHotlinkHost = (u) => !!window.isHotlinkHost?.(u);

  if (!window.__streambooruCardMenuDismiss) {
    window.__streambooruCardMenuDismiss = true;
    document.addEventListener('pointerdown', (event) => {
      document.querySelectorAll('.card-more[open]').forEach((menu) => {
        if (!menu.contains(event.target)) menu.removeAttribute('open');
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') document.querySelectorAll('.card-more[open]').forEach((menu) => menu.removeAttribute('open'));
    });
  }

  const isVideoUrl = (u) => {
    try { const p = new URL(u, 'https://x/').pathname.toLowerCase(); return /\.(mp4|webm|mov|m4v)$/i.test(p); }
    catch { return /\.(mp4|webm|mov|m4v)$/i.test(String(u || '').toLowerCase()); }
  };

  // Booru preview images are commonly only 150–300px wide. Prefer the site's
  // display-sized sample so cards stay sharp, then retain lightweight fallbacks.
  const thumbCandidates = (post) => {
    const seen = new Set();
    return [post.sample_url, post.preview_url, post.file_url]
      .filter(Boolean)
      .filter((url) => !isVideoUrl(url))
      .filter((url) => !seen.has(url) && seen.add(url));
  };

  const isVideoPost = (post) =>
    !!post.is_video || isVideoUrl(post.file_url || '') || isVideoUrl(post.sample_url || '');

  async function proxyIntoImg(imgEl, url) {
    if (!window.api?.proxyImage || !url || isVideoUrl(url)) return false;
    try {
      const prox = await window.api.proxyImage(url);
      if (prox?.ok && (prox.dataUrl || prox.url)) {
        imgEl.src = prox.dataUrl || prox.url;
        return imgEl.complete ? imgEl.naturalWidth > 0 : true;
      }
    } catch (e) {
      console.warn('proxyImage failed (thumb)', e);
    }
    return false;
  }

  /** Direct load first on Electron (webRequest injects Referer); proxy on error or web/Android hotlinks. */
  function attachThumbImage(imgEl, urls, onGiveUp) {
    if (!urls.length) {
      onGiveUp?.();
      return;
    }

    let idx = 0;

    const tryDirect = (url) => new Promise((resolve) => {
      const finish = (ok) => {
        imgEl.onload = null;
        imgEl.onerror = null;
        resolve(ok);
      };
      imgEl.onload = () => finish(imgEl.naturalWidth > 0);
      imgEl.onerror = () => finish(false);
      imgEl.removeAttribute('srcset');
      imgEl.src = url;
    });

    const run = async () => {
      while (idx < urls.length) {
        const url = urls[idx++];
        // On web/Android a hotlinked direct load is guaranteed to 403/CORS-fail,
        // so go straight to the proxy instead of firing a doomed request first.
        if ((isWebBrowser() || isAndroid()) && isHotlinkHost(url)) {
          if (await proxyIntoImg(imgEl, url)) return;
          continue;
        }
        if (await tryDirect(url)) return;
        if (await proxyIntoImg(imgEl, url)) return;
      }
      onGiveUp?.();
    };

    run();
  }

  // A long scroll leaves hundreds of cards mounted, and a preview that starts downloading
  // as soon as its card is built holds one of the six connections the browser allows per
  // host. Enough of them and everything below queues behind video nobody is looking at,
  // which is why thumbnails stop appearing the further you scroll. Only previews near the
  // viewport get to load.
  const videoWindow = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const vid = entry.target;
      if (entry.isIntersecting) { vid._sbEnter?.(); continue; }
      vid._sbLeave?.();
      if (!vid.isConnected) videoWindow.unobserve(vid);
    }
  }, { rootMargin: '400px 0px' });

  function attachVideoThumb(thumbEl, url, onGiveUp) {
    if (!url) {
      onGiveUp?.();
      return;
    }

    const autoplay = window.__sbSettings?.autoplayVideoThumbs !== false;

    thumbEl.classList.add('thumb--video');
    const vid = document.createElement('video');
    vid.className = 'thumb-video';
    vid.muted = true;
    vid.loop = true;
    vid.playsInline = true;
    vid.autoplay = autoplay;
    vid.preload = autoplay ? 'auto' : 'metadata';
    vid.setAttribute('aria-label', 'Video preview');
    vid.draggable = false;

    let onScreen = false;
    const play = () => { if (!onScreen) return; try { vid.play()?.catch(() => {}); } catch {} };
    const pause = () => { try { vid.pause(); } catch {} };

    const loadBlob = async () => {
      try {
        const blob = await window.api.fetchMediaBlob?.(url);
        if (!blob) return false;
        const objUrl = URL.createObjectURL(blob);
        vid._blobUrl = objUrl;
        vid.src = objUrl;
        return true;
      } catch {
        return false;
      }
    };

    if (autoplay) {
      vid.onloadeddata = play;
    } else {
      // Hover-to-play when grid autoplay is disabled in Settings
      thumbEl.addEventListener('pointerenter', play);
      thumbEl.addEventListener('pointerleave', pause);
    }
    vid.onerror = async () => {
      if (await loadBlob()) return;
      if (vid._blobUrl) URL.revokeObjectURL(vid._blobUrl);
      vid.remove();
      onGiveUp?.();
    };

    let requested = false;
    vid._sbEnter = () => {
      onScreen = true;
      if (!requested) { requested = true; vid.src = url; }
      if (autoplay) play();
    };
    vid._sbLeave = () => { onScreen = false; pause(); };

    thumbEl.insertBefore(vid, thumbEl.firstChild);
    videoWindow.observe(vid);
  }

  // tap (pointer-first with touch fallback)
  function onTap(el, handler, opts = {}) {
    const maxMove = opts.maxMove ?? 10;
    const maxTime = opts.maxTime ?? 350;
    let startX = 0, startY = 0, t0 = 0, moved = 0, active = false;

    const down = (e) => {
      active = true;
      const p = e.touches ? e.touches[0] : e;
      startX = p.clientX; startY = p.clientY; t0 = Date.now(); moved = 0;
    };
    const move = (e) => {
      if (!active) return;
      const p = e.touches ? e.touches[0] : e;
      const dx = p.clientX - startX, dy = p.clientY - startY;
      moved = Math.max(moved, Math.hypot(dx, dy));
    };
    const up = () => {
      if (!active) return;
      active = false;
      const dt = Date.now() - t0;
      if (moved <= maxMove && dt <= maxTime) handler();
    };

    el.addEventListener('pointerdown', down, { passive: true });
    el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerup', up, { passive: true });
    el.addEventListener('pointercancel', () => { active = false; }, { passive: true });

    if (!('onpointerdown' in window)) {
      el.addEventListener('touchstart', down, { passive: true });
      el.addEventListener('touchmove', move, { passive: true });
      el.addEventListener('touchend', up, { passive: true });
      el.addEventListener('click', () => handler());
    }
  }

  const buildActions = (post, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'actions';

    const mediaUrl = post.file_url || post.sample_url || post.preview_url || '';
    const btnFav = document.createElement('button');
    btnFav.className = 'action-save';
    const updateFavoriteButton = () => {
      const faved = window.isLocalFavorite(post);
      btnFav.textContent = faved ? '♥ Faved' : '♡ Fave';
      btnFav.setAttribute('aria-pressed', String(faved));
      btnFav.title = faved ? 'Remove from favourites' : 'Add to favourites (does not download the file)';
    };
    updateFavoriteButton();
    btnFav.addEventListener('click', async () => {
      btnFav.disabled = true;
      await window.toggleLocalFavorite(post);
      updateFavoriteButton();
      btnFav.disabled = false;
    });

    const btnDownload = document.createElement('button');
    btnDownload.className = 'action-download';
    btnDownload.textContent = 'Download';
    btnDownload.title = 'Download original media';
    btnDownload.addEventListener('click', async () => {
      try {
        if (!mediaUrl) return;
        btnDownload.disabled = true;
        btnDownload.textContent = 'Downloading…';
        btnDownload.dataset.state = 'busy';
        const siteName = post?.site?.name || post?.site?.baseUrl || 'unknown';
        const fileName = (window.getFileNameForPost ? window.getFileNameForPost(post, idx) : null);
        const result = await window.api.downloadImage({ url: mediaUrl, siteName, fileName });
        if (result?.cancelled) return;
        if (result && result.ok === false) throw new Error(result.error || 'Download failed');
        btnDownload.textContent = 'Saved ✓';
        btnDownload.dataset.state = 'done';
        setTimeout(() => {
          if (!btnDownload.isConnected) return;
          btnDownload.textContent = 'Download';
          delete btnDownload.dataset.state;
        }, 1800);
      } catch (e) {
        console.error('Download error:', e);
        const msg = `Failed to download this media${e?.message ? `: ${e.message}` : '.'}`;
        if (typeof window.toast === 'function') window.toast(msg, { type: 'error' }); else alert(msg);
      } finally {
        btnDownload.disabled = false;
        if (btnDownload.dataset.state === 'busy') {
          btnDownload.textContent = 'Download';
          delete btnDownload.dataset.state;
        }
      }
    });

    wrap.appendChild(btnFav);
    wrap.appendChild(btnDownload);

    const more = document.createElement('details');
    more.className = 'card-more';
    const summary = document.createElement('summary');
    summary.textContent = 'More';
    summary.title = 'More actions';
    summary.setAttribute('aria-label', 'More actions');
    const menu = document.createElement('div');
    menu.className = 'card-menu';

    const btnOpenPost = document.createElement('button');
    btnOpenPost.textContent = 'Open post ↗';
    btnOpenPost.disabled = !post.post_url;
    btnOpenPost.addEventListener('click', () => { more.removeAttribute('open'); openExternal(post.post_url); });

    const btnOpenMedia = document.createElement('button');
    btnOpenMedia.textContent = 'Open original ↗';
    btnOpenMedia.disabled = !mediaUrl;
    btnOpenMedia.addEventListener('click', () => { more.removeAttribute('open'); openExternal(mediaUrl); });

    menu.appendChild(btnOpenPost);
    menu.appendChild(btnOpenMedia);
    more.appendChild(summary);
    more.appendChild(menu);
    wrap.appendChild(more);
    return wrap;
  };

  const canonRating = (rating) => {
    const value = String(rating || '').toLowerCase();
    if (value === 'g' || value === 'general' || value.startsWith('s')) return 's';
    if (value.startsWith('q') || value === 'sensitive' || value === 'mature') return 'q';
    return value.startsWith('e') ? 'e' : '';
  };

  const topTags = (post, max = 4) => {
    const seen = new Set();
    const out = [];
    for (const list of [post.artist, post.character, post.copyright, post.tags]) {
      for (const t of (Array.isArray(list) ? list : [])) {
        const tag = String(t);
        if (!tag || seen.has(tag)) continue;
        seen.add(tag);
        out.push(tag);
        if (out.length >= max) return out;
      }
    }
    return out;
  };

  window.PostCard = (post, index = 0) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.key = `${post?.site?.baseUrl || ''}#${post?.id}`;
    const ratingCanon = canonRating(post?.rating);
    if (ratingCanon) card.dataset.rating = ratingCanon;

    const w = Number(post?.width) || 0;
    const h = Number(post?.height) || 0;
    const aspect = w > 0 && h > 0 ? Math.min(2.2, Math.max(0.5, w / h)) : 1;
    card.dataset.ar = String(aspect);

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.style.setProperty('--natural-ar', String(aspect));

    const videoPost = isVideoPost(post);
    const staticUrls = thumbCandidates(post);
    const gridVideo = post.grid_video_url || '';

    const showPlaceholder = () => {
      thumb.classList.add('thumb--video');
      const placeholder = document.createElement('div');
      placeholder.className = 'thumb-placeholder';
      placeholder.setAttribute('aria-label', videoPost ? 'Video post' : 'No preview');
      placeholder.textContent = videoPost ? '▶' : '?';
      thumb.appendChild(placeholder);
    };

    const fallbackFromStatic = () => {
      if (gridVideo) attachVideoThumb(thumb, gridVideo, showPlaceholder);
      else showPlaceholder();
    };

    if (staticUrls.length) {
      const img = document.createElement('img');
      img.loading = index < 16 ? 'eager' : 'lazy';
      img.decoding = 'async';
      img.alt = videoPost ? 'Video preview' : String(post?.id ?? '');
      img.draggable = false;
      img.style.touchAction = 'pan-y';
      img.style.userSelect = 'none';
      img.style.webkitUserDrag = 'none';
      thumb.appendChild(img);
      attachThumbImage(img, staticUrls, () => {
        img.remove();
        fallbackFromStatic();
      });

      if (videoPost) {
        const badge = document.createElement('span');
        badge.className = 'thumb-video-badge';
        badge.textContent = 'VIDEO';
        badge.setAttribute('aria-hidden', 'true');
        thumb.appendChild(badge);
      }
    } else if (gridVideo) {
      attachVideoThumb(thumb, gridVideo, showPlaceholder);
    } else {
      showPlaceholder();
    }

    const hit = document.createElement('div');
    hit.className = 'hitbox';
    hit.setAttribute('role', 'button');
    hit.setAttribute('tabindex', '0');
    hit.setAttribute('aria-label', `View ${videoPost ? 'video' : 'image'} from ${post?.site?.name || post?.site?.type || 'source'}`);
    hit.title = 'View media';
    onTap(hit, () => { if (window.openLightbox) window.openLightbox(post); });
    hit.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (window.openLightbox) window.openLightbox(post);
    });
    thumb.appendChild(hit);

    const chipTags = topTags(post);
    if (chipTags.length && typeof window.searchForTag === 'function') {
      const chips = document.createElement('div');
      chips.className = 'tags-overlay';
      for (const tag of chipTags) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tag-chip';
        chip.textContent = tag;
        chip.title = `Search ${tag}`;
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          window.searchForTag(tag);
        });
        chips.appendChild(chip);
      }
      thumb.appendChild(chips);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    const left = document.createElement('div');
    left.className = 'metric';
    const favs = Number.isFinite(post.favorites) ? post.favorites : 0;
    const score = Number.isFinite(post.score) ? post.score : 0;
    const sourceStats = document.createElement('span');
    sourceStats.textContent = `${favs} fav · score ${score}`;
    left.appendChild(sourceStats);
    const sbFavs = document.createElement('span');
    sbFavs.className = 'sb-favs';
    sbFavs.hidden = true;
    const cachedCount = typeof window.getSbFaveCount === 'function' ? window.getSbFaveCount(post) : null;
    if (cachedCount > 0) {
      sbFavs.textContent = `♥ ${cachedCount}`;
      sbFavs.title = `${cachedCount} StreamBooru user${cachedCount === 1 ? '' : 's'} faved this`;
      sbFavs.hidden = false;
    }
    left.appendChild(sbFavs);
    const right = document.createElement('div');
    const siteLabel = document.createElement('span');
    siteLabel.className = 'site';
    siteLabel.textContent = post?.site?.name || post?.site?.type || 'site';
    siteLabel.title = siteLabel.textContent;
    right.appendChild(siteLabel);
    meta.appendChild(left);
    meta.appendChild(right);

    thumb.appendChild(meta);
    card.appendChild(thumb);
    card.appendChild(buildActions(post, index));

    return card;
  };
})();
