// Settings modal
(function () {
  'use strict';

  function field(labelText, control, hint = '') {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const label = document.createElement('label');
    label.className = 'settings-label';
    label.textContent = labelText;
    row.appendChild(label);
    const controlWrap = document.createElement('div');
    controlWrap.className = 'settings-control';
    controlWrap.appendChild(control);
    if (hint) {
      const hintEl = document.createElement('div');
      hintEl.className = 'hint';
      hintEl.textContent = hint;
      controlWrap.appendChild(hintEl);
    }
    row.appendChild(controlWrap);
    return row;
  }

  function select(options, value, onChange) {
    const el = document.createElement('select');
    for (const [val, label] of options) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (val === value) opt.selected = true;
      el.appendChild(opt);
    }
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }

  function checkbox(checked, onChange, describe) {
    const wrap = document.createElement('label');
    wrap.className = 'settings-check';
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = !!checked;
    el.addEventListener('change', () => onChange(el.checked));
    wrap.appendChild(el);
    wrap.appendChild(document.createTextNode(` ${describe}`));
    return wrap;
  }

  window.renderSettings = function (container, { settings = {}, nameTemplate = '', onChange }) {
    container.innerHTML = '';
    container.classList.remove('hidden');
    container.setAttribute('aria-hidden', 'false');
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'true');
    container.setAttribute('tabindex', '-1');

    const panel = document.createElement('div');
    panel.className = 'panel settings-panel';
    const h2 = document.createElement('h2');
    h2.textContent = 'Settings';
    panel.appendChild(h2);

    const content = document.createElement('div');
    content.className = 'content-scroll';

    const emit = (patch) => { try { onChange?.(patch); } catch (e) { console.warn('settings change failed', e); } };

    content.appendChild(field('Theme', select([
      ['dark', 'Dark'],
      ['light', 'Light']
    ], settings.theme === 'light' ? 'light' : 'dark', (v) => emit({ theme: v }))));

    content.appendChild(field('Grid density', select([
      ['compact', 'Compact — more, smaller cards'],
      ['cozy', 'Cozy — default'],
      ['comfortable', 'Comfortable — fewer, larger cards']
    ], settings.density || 'cozy', (v) => emit({ density: v }))));

    content.appendChild(field('Card layout', select([
      ['cover', 'Square crop — uniform grid'],
      ['natural', 'Natural aspect — no cropping']
    ], settings.cardFit === 'natural' ? 'natural' : 'cover', (v) => emit({ cardFit: v })),
    'Natural aspect shows portrait and landscape art uncropped.'));

    content.appendChild(field('Video thumbnails', checkbox(
      settings.autoplayVideoThumbs !== false,
      (v) => emit({ autoplayVideoThumbs: v }),
      'Autoplay video previews in the grid'
    ), 'When off, video previews play while hovered.'));

    content.appendChild(field('Safe mode', checkbox(
      settings.blurUnsafe === true,
      (v) => emit({ blurUnsafe: v }),
      'Blur questionable/explicit thumbnails until hovered'
    )));

    const templateInput = document.createElement('input');
    templateInput.type = 'text';
    templateInput.spellcheck = false;
    templateInput.placeholder = '{site}-{id}';
    templateInput.value = nameTemplate || '';
    let templateTimer = null;
    templateInput.addEventListener('input', () => {
      clearTimeout(templateTimer);
      templateTimer = setTimeout(() => emit({ nameTemplate: templateInput.value }), 400);
    });
    templateInput.addEventListener('change', () => emit({ nameTemplate: templateInput.value }));
    content.appendChild(field('Filename template', templateInput,
      'Tokens: {site} {id} {score} {rating} {width} {height} {artist} {copyright} {character} {created} {original_name}'));

    if (typeof window.api?.syncSourceFavorites === 'function') {
      const syncBtn = document.createElement('button');
      syncBtn.type = 'button';
      syncBtn.textContent = 'Sync now';
      syncBtn.addEventListener('click', async () => {
        syncBtn.disabled = true;
        syncBtn.textContent = 'Syncing…';
        try {
          window.reportSourceFavSync?.(await window.api.syncSourceFavorites());
        } catch (e) {
          window.toast?.(`Source favourites: ${e?.message || e}`, { type: 'error' });
        } finally {
          syncBtn.disabled = false;
          syncBtn.textContent = 'Sync now';
        }
      });
      content.appendChild(field('Source-site favourites', syncBtn,
        'Merge favourites both ways with the Danbooru, Moebooru and e621 accounts you have credentials for. Runs on its own shortly after startup.'));
    }

    const versionRow = document.createElement('div');
    versionRow.className = 'hint settings-version';
    versionRow.textContent = 'StreamBooru';
    window.Platform?.getVersion?.().then((v) => {
      if (v) versionRow.textContent = `StreamBooru ${v}`;
    }).catch(() => {});
    content.appendChild(versionRow);

    panel.appendChild(content);

    const btns = document.createElement('div');
    btns.className = 'btns';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    btns.appendChild(closeBtn);
    panel.appendChild(btns);
    container.appendChild(panel);

    let releaseOverlay = null;
    const hide = () => {
      container.classList.add('hidden');
      container.setAttribute('aria-hidden', 'true');
      container.innerHTML = '';
      document.removeEventListener('keydown', escHandler, true);
      container.removeEventListener('click', backdropHandler, true);
      releaseOverlay?.();
      releaseOverlay = null;
    };
    const escHandler = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); hide(); } };
    const backdropHandler = (e) => { if (e.target === container) hide(); };

    closeBtn.addEventListener('click', hide);
    document.addEventListener('keydown', escHandler, true);
    container.addEventListener('click', backdropHandler, true);
    releaseOverlay = window.SBOverlay?.open?.('settings', { close: hide, root: container }) || null;
    setTimeout(() => panel.querySelector('select')?.focus(), 0);
  };
})();
