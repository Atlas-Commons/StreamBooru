(() => {
  const openExternal = (url) => { if (url) window.api.openExternal(url); };

  const isElectron = () => !!(window.Platform?.isElectron?.());
  const isAndroid = () => !!(window.Platform?.isAndroid?.());
  const isWebBrowser = () => !isElectron() && !isAndroid();
  const hostMatches = (host, domain) => host === domain || host.endsWith(`.${domain}`);

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

  function isHotlinkHost(u) {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return ['donmai.us', 'yande.re', 'konachan.com', 'konachan.net', 'e621.net', 'e926.net',
        'e621.media', 'e926.media', 'derpibooru.org', 'derpicdn.net', 'gelbooru.com',
        'safebooru.org', 'rule34.xxx', 'realbooru.com', 'xbooru.com', 'tbib.org',
        'hypnohub.net'].some((domain) => hostMatches(h, domain));
    } catch { return false; }
  }

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

      if ((isWebBrowser() || isAndroid()) && isHotlinkHost(url)) {
        imgEl.onload = null;
        imgEl.onerror = null;
        proxyIntoImg(imgEl, url).then(resolve);
      }
    });

    const run = async () => {
      while (idx < urls.length) {
        const url = urls[idx++];
        if (await tryDirect(url)) return;
        if (await proxyIntoImg(imgEl, url)) return;
      }
      onGiveUp?.();
    };

    run();
  }

  function attachVideoThumb(thumbEl, url, onGiveUp) {
    if (!url) {
      onGiveUp?.();
      return;
    }

    thumbEl.classList.add('thumb--video');
    const vid = document.createElement('video');
    vid.className = 'thumb-video';
    vid.muted = true;
    vid.loop = true;
    vid.playsInline = true;
    vid.autoplay = true;
    vid.preload = 'auto';
    vid.setAttribute('aria-label', 'Video preview');
    vid.draggable = false;

    const play = () => { try { vid.play()?.catch(() => {}); } catch {} };

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

    vid.onloadeddata = play;
    vid.onerror = async () => {
      if (await loadBlob()) return;
      if (vid._blobUrl) URL.revokeObjectURL(vid._blobUrl);
      vid.remove();
      onGiveUp?.();
    };

    vid.src = url;
    thumbEl.insertBefore(vid, thumbEl.firstChild);
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
      const saved = window.isLocalFavorite(post);
      btnFav.textContent = saved ? 'Saved' : 'Save';
      btnFav.setAttribute('aria-pressed', String(saved));
      btnFav.title = saved ? 'Remove from favourites' : 'Save to favourites';
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
        alert(`Failed to download this media${e?.message ? `: ${e.message}` : '.'}`);
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

  window.PostCard = (post, index = 0) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.key = `${post?.site?.baseUrl || ''}#${post?.id}`;

    const thumb = document.createElement('div');
    thumb.className = 'thumb';

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

    const meta = document.createElement('div');
    meta.className = 'meta';
    const left = document.createElement('div');
    left.className = 'metric';
    const favs = Number.isFinite(post.favorites) ? post.favorites : 0;
    const score = Number.isFinite(post.score) ? post.score : 0;
    left.textContent = `${favs} fav · score ${score}`;
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
