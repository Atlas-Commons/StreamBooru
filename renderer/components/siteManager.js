(function () {
  const POPULAR_SITES = {
    danbooru: [
      { label: 'Danbooru (donmai.us)', url: 'https://danbooru.donmai.us' },
      { label: 'Safebooru (donmai.us)', url: 'https://safebooru.donmai.us' }
    ],
    moebooru: [
      { label: 'Yande.re', url: 'https://yande.re' },
      { label: 'Konachan.com', url: 'https://konachan.com' },
      { label: 'Konachan.net', url: 'https://konachan.net' },
      { label: 'Hypnohub', url: 'https://hypnohub.net' },
      { label: 'TBIB', url: 'https://tbib.org' }
    ],
    gelbooru: [
      { label: 'Safebooru.org', url: 'https://safebooru.org' },
      { label: 'Gelbooru.com', url: 'https://gelbooru.com' },
      { label: 'Rule34 (rule34.xxx)', url: 'https://rule34.xxx' },
      { label: 'Realbooru', url: 'https://realbooru.com' },
      { label: 'Xbooru', url: 'https://xbooru.com' }
    ],
    e621: [
      { label: 'e621 (R18)', url: 'https://e621.net' },
      { label: 'e926 (SFW)', url: 'https://e926.net' }
    ],
    derpibooru: [
      { label: 'Derpibooru', url: 'https://derpibooru.org' }
    ]
  };

  const RATINGS = [
    { value: 'safe', label: 'Safe' },
    { value: 'questionable', label: 'Questionable' },
    { value: 'explicit', label: 'Explicit' },
    { value: 'any', label: 'Any' }
  ];

  const stripRatingTokens = function (tagsStr) {
    if (!tagsStr) return '';
    const tokens = String(tagsStr)
      .trim()
      .split(/\s+/)
      .filter((t) => !/^rating:(?:safe|questionable|explicit|any|[sqe])$/i.test(t));
    return tokens.join(' ');
  };

  const accountUrlFor = function (type, baseUrl) {
    const b = (baseUrl || '').replace(/\/+$/, '');
    if (!b) return '';
    if (type === 'danbooru') return `${b}/profile`;
    if (type === 'moebooru') return `${b}/user/home`;
    if (type === 'gelbooru') return `${b}/index.php?page=account`;
    if (type === 'e621') return `${b}/users/login`;
    if (type === 'derpibooru') return `${b}/users/sign_in`;
    return b;
  };

  const helpUrlFor = function (type, baseUrl) {
    const b = (baseUrl || '').replace(/\/+$/, '');
    if (type === 'danbooru') return `${b}/help/api`;
    if (type === 'moebooru') return `${b}/help/api`;
    if (type === 'gelbooru') return `${b}/index.php?page=help`;
    if (type === 'e621') return `${b}/help/api`;
    if (type === 'derpibooru') return `${b}/pages/api`;
    return b;
  };

  const msToClock = function(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const s = Math.round(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const mm = m % 60;
      return `${h}h ${mm}m`;
    }
    return `${m}m ${r}s`;
  };

  const fmtInfo = function(x) {
    if (x == null) return '';
    // If adapters return a structured object, show a friendly summary
    if (typeof x === 'object') {
      const name = x.name || x.login || x.user || '';
      const lvl = x.level || x.tier || '';
      const id = x.id || '';
      const parts = [];
      if (name) parts.push(String(name));
      if (lvl) parts.push(`lvl ${lvl}`);
      if (id && !name && !lvl) parts.push(`#${id}`);
      if (parts.length) return parts.join(' • ');
      try { return JSON.stringify(x); } catch { return String(x); }
    }
    return String(x);
  };

  const siteCard = function (site, idx, onChange, onDelete, onTest) {
    const s = {
      name: site.name || '',
      baseUrl: site.baseUrl || '',
      type: site.type || 'danbooru',
      rating: site.rating || 'safe',
      tags: stripRatingTokens(site.tags || ''),
      queryDialect: site.queryDialect || site.query_dialect || 'auto',
      credentials: { ...(site.credentials || {}) }
    };

    const card = document.createElement('div');
    card.className = 'site-card compact';

    const header = document.createElement('div');
    header.className = 'row header';

    const name = document.createElement('input');
    name.placeholder = 'Name';
    name.value = s.name;

    const baseUrl = document.createElement('input');
    baseUrl.placeholder = 'Base URL (e.g., https://danbooru.donmai.us)';
    baseUrl.value = s.baseUrl;

    const type = document.createElement('select');
    ['danbooru', 'moebooru', 'gelbooru', 'e621', 'derpibooru'].forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      if (s.type === t) opt.selected = true;
      type.appendChild(opt);
    });

    const rating = document.createElement('select');
    RATINGS.forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r.value;
      opt.textContent = r.label;
      if (s.rating === r.value) opt.selected = true;
      rating.appendChild(opt);
    });

    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.className = 'btn-small danger';
    del.addEventListener('click', () => onDelete(idx));

    header.appendChild(name);
    header.appendChild(baseUrl);
    header.appendChild(type);
    header.appendChild(rating);
    header.appendChild(del);

    const line = document.createElement('div');
    line.className = 'row line';

    const tags = document.createElement('input');
    tags.placeholder = 'Additional tags (e.g., landscape 1girl)';
    tags.value = s.tags;

    const picker = document.createElement('select');
    const dash = document.createElement('option');
    dash.value = '';
    dash.textContent = 'Pick popular site…';
    picker.appendChild(dash);
    (POPULAR_SITES[s.type] || []).forEach(({ label, url }) => {
      const opt = document.createElement('option');
      opt.value = url;
      opt.textContent = label;
      picker.appendChild(opt);
    });
    picker.addEventListener('change', () => {
      if (picker.value) {
        baseUrl.value = picker.value;
        s.baseUrl = picker.value;
        emitChange();
      }
    });

    line.appendChild(tags);
    line.appendChild(picker);

    const dialect = document.createElement('select');
    dialect.title = 'Advanced-search syntax used by this Gelbooru-compatible site';
    [
      { value: 'auto', label: 'Syntax: Auto' },
      { value: 'gelbooru', label: 'Syntax: Gelbooru' },
      { value: 'rule34', label: 'Syntax: Rule34.xxx' }
    ].forEach(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = s.queryDialect === value;
      dialect.appendChild(option);
    });
    line.appendChild(dialect);
    const updateDialectVisibility = () => {
      const visible = s.type === 'gelbooru';
      dialect.hidden = !visible;
      line.classList.toggle('has-dialect', visible);
    };
    updateDialectVisibility();

    const actions = document.createElement('div');
    actions.className = 'actions-row';

    const linkBtn = (label, handler, extraClass = '') => {
      const a = document.createElement('button');
      a.type = 'button';
      a.className = `link-btn ${extraClass}`.trim();
      a.textContent = label;
      a.addEventListener('click', handler);
      return a;
    };

    // Info badges and hint
    const apiBadge = document.createElement('span'); apiBadge.className = 'badge muted'; apiBadge.textContent = '';
    const authBadge = document.createElement('span'); authBadge.className = 'badge muted'; authBadge.textContent = '';
    const rateBadge = document.createElement('span'); rateBadge.className = 'badge muted'; rateBadge.textContent = '';
    const infoSpan = document.createElement('span'); infoSpan.className = 'hint'; infoSpan.style.marginLeft = '6px';

    // Open Account Page + API Help
    const openAccountBtn = linkBtn('Open Account Page', () => {
      const url = accountUrlFor(s.type, s.baseUrl);
      if (url) window.api.openExternal(url);
    });
    const apiHelpBtn = linkBtn('API Help', () => {
      const url = helpUrlFor(s.type, s.baseUrl);
      if (url) window.api.openExternal(url);
    });

    // Test flow (API + Auth + Rate-limit)
    const testBtn = linkBtn('Test', async () => {
      apiBadge.textContent = 'API…'; apiBadge.className = 'badge warn';
      authBadge.textContent = 'Auth…'; authBadge.className = 'badge muted';
      rateBadge.textContent = ''; rateBadge.className = 'badge muted'; rateBadge.title = '';
      infoSpan.textContent = '';

      const probeSite = {
        name: s.name || s.baseUrl,
        baseUrl: s.baseUrl,
        type: s.type,
        rating: s.rating,
        tags: s.tags,
        credentials: s.credentials
      };

      // API probe
      try {
        const res = (typeof window.api.fetchBooru === 'function')
          ? await window.api.fetchBooru({ site: probeSite, viewType: 'new', limit: 3, cursor: null, search: probeSite.tags || '' })
          : await onTest?.(probeSite);
        const count = (res?.posts || []).length;
        if (count > 0) { apiBadge.textContent = 'API OK'; apiBadge.className = 'badge ok'; }
        else { apiBadge.textContent = 'No results'; apiBadge.className = 'badge warn'; }
      } catch (e) {
        apiBadge.textContent = 'API error'; apiBadge.className = 'badge err';
        infoSpan.textContent = (infoSpan.textContent ? infoSpan.textContent + ' • ' : '') + String(e?.message || e || '');
      }

      // Auth probe
      try {
        const chk = await window.api.authCheck?.(probeSite);
        if (!chk || chk.supported === false) {
          authBadge.textContent = 'No auth'; authBadge.className = 'badge muted';
        } else if (chk.ok) {
          authBadge.textContent = 'Auth OK'; authBadge.className = 'badge ok';
          if (chk.info) {
            const txt = fmtInfo(chk.info);
            if (txt) infoSpan.textContent = (infoSpan.textContent ? infoSpan.textContent + ' • ' : '') + txt;
          }
        } else {
          const hasCreds = !!(probeSite.credentials && Object.values(probeSite.credentials).some(Boolean));
          authBadge.textContent = hasCreds ? 'Auth fail' : 'No auth';
          authBadge.className = hasCreds ? 'badge err' : 'badge warn';
          const reason = chk.reason ? fmtInfo(chk.reason) : (hasCreds ? 'Bad credentials?' : 'Not configured');
          if (reason) infoSpan.textContent = (infoSpan.textContent ? infoSpan.textContent + ' • ' : '') + reason;
        }
      } catch (e) {
        authBadge.textContent = 'Auth error'; authBadge.className = 'badge err';
        infoSpan.textContent = (infoSpan.textContent ? infoSpan.textContent + ' • ' : '') + String(e?.message || e || '');
      }

      // Rate-limit probe (Danbooru only)
      try {
        if (probeSite.type === 'danbooru' && typeof window.api.rateLimit === 'function') {
          const r = await window.api.rateLimit(probeSite);
          if (r && r.ok) {
            const lim = Number(r.limit ?? 0), rem = Number(r.remaining ?? 0), reset = Number(r.reset ?? 0);
            rateBadge.className = 'badge ' + (rem > 0 ? 'ok' : 'warn');
            rateBadge.textContent = `RL ${isFinite(rem)?rem:'?'}/${isFinite(lim)?lim:'?'}`;
            if (reset) {
              const now = Math.floor(Date.now() / 1000);
              const ms = Math.max(0, (reset - now) * 1000);
              rateBadge.title = `Resets in ${msToClock(ms)} (unix ${reset})`;
            } else {
              rateBadge.title = '';
            }
          } else {
            rateBadge.className = 'badge muted';
            rateBadge.textContent = '';
            rateBadge.title = '';
          }
        } else {
          rateBadge.className = 'badge muted';
          rateBadge.textContent = '';
          rateBadge.title = '';
        }
      } catch {
        rateBadge.className = 'badge muted';
        rateBadge.textContent = '';
        rateBadge.title = '';
      }
    }, 'accent');

    // Compose actions row
    actions.appendChild(openAccountBtn);
    actions.appendChild(apiHelpBtn);
    actions.appendChild(testBtn);
    actions.appendChild(apiBadge);
    actions.appendChild(authBadge);
    actions.appendChild(rateBadge);
    actions.appendChild(infoSpan);

    const authWrap = document.createElement('div');
    authWrap.className = 'auth light';

    const authHint = document.createElement('div');
    authHint.className = 'hint';
    authHint.style.gridColumn = '1 / -1';
    authHint.textContent =
      s.type === 'moebooru'
        ? 'Use Login + Password Hash (from your account page).'
        : s.type === 'danbooru'
        ? 'Use Login + API Key from your profile.'
        : s.type === 'gelbooru'
        ? 'Use User ID + API Key if supported.'
        : s.type === 'e621'
        ? 'Authentication is optional; browsing works without it.'
        : s.type === 'derpibooru'
        ? 'Authentication is optional; browsing works without it.'
        : 'No authentication for this engine.';

    const authField = function (ph, key) {
      const input = document.createElement('input');
      input.placeholder = ph;
      input.value = s.credentials[key] || '';
      input.addEventListener('change', () => {
        s.credentials[key] = input.value.trim();
        emitChange();
      });
      return input;
    };

    const rebuildAuth = function () {
      authWrap.innerHTML = '';
      authWrap.appendChild(authHint);
      if (s.type === 'danbooru') {
        authWrap.appendChild(authField('Login', 'login'));
        authWrap.appendChild(authField('API Key', 'api_key'));
      } else if (s.type === 'moebooru') {
        authWrap.appendChild(authField('Login', 'login'));
        authWrap.appendChild(authField('Password Hash', 'password_hash'));
      } else if (s.type === 'gelbooru') {
        authWrap.appendChild(authField('User ID', 'user_id'));
        authWrap.appendChild(authField('API Key', 'api_key'));
      } else if (s.type === 'e621') {
        authWrap.appendChild(authField('Login (optional)', 'login'));
        authWrap.appendChild(authField('API Key (optional)', 'api_key'));
      } else if (s.type === 'derpibooru') {
        const note = document.createElement('div');
        note.className = 'hint';
        note.style.gridColumn = '1 / -1';
        note.textContent = 'No API auth required for browsing.';
        authWrap.appendChild(note);
      } else {
        const note = document.createElement('div');
        note.className = 'hint';
        note.style.gridColumn = '1 / -1';
        note.textContent = 'This site does not have token login.';
        authWrap.appendChild(note);
      }
    };
    rebuildAuth();

    card.appendChild(header);
    card.appendChild(line);
    card.appendChild(actions);
    card.appendChild(authWrap);

    const emitChange = function () {
      s.tags = stripRatingTokens(s.tags);
      onChange(idx, { ...s });
    };

    [name, baseUrl, type, rating, tags, dialect].forEach((el) => {
      el.addEventListener('change', () => {
        s.name = name.value.trim();
        s.baseUrl = baseUrl.value.trim();
        s.type = type.value;
        s.rating = rating.value;
        s.tags = stripRatingTokens(tags.value);
        s.queryDialect = dialect.value;
        if (el === type) {
          while (picker.firstChild) picker.removeChild(picker.firstChild);
          const dash2 = document.createElement('option');
          dash2.value = '';
          dash2.textContent = 'Pick popular site…';
          picker.appendChild(dash2);
          (POPULAR_SITES[s.type] || []).forEach(({ label, url }) => {
            const opt = document.createElement('option');
            opt.value = url;
            opt.textContent = label;
            picker.appendChild(opt);
          });
          rebuildAuth();
          updateDialectVisibility();
        }
        emitChange();
      });
    });

    return card;
  };

  window.renderSiteManager = function (container, config, onSave, onClose) {
    try {
      container.innerHTML = '';
      container.classList.remove('hidden');
      container.setAttribute('aria-hidden', 'false');
      container.setAttribute('role', 'dialog');
      container.setAttribute('aria-modal', 'true');
      container.setAttribute('tabindex', '-1');

      const panel = document.createElement('div');
      panel.className = 'panel';
      const h2 = document.createElement('h2');
      h2.textContent = 'Manage Sites';
      panel.appendChild(h2);

      const content = document.createElement('div');
      content.className = 'content-scroll';

      const list = document.createElement('div');
      const sites = config.sites ? [...config.sites] : [];

      const rerenderList = function () {
        list.innerHTML = '';
        sites.forEach((s, i) => {
          list.appendChild(
            siteCard(
              s,
              i,
              (idx, updated) => { sites[idx] = { ...sites[idx], ...updated, tags: stripRatingTokens(updated.tags) }; },
              (idx) => { sites.splice(idx, 1); rerenderList(); },
              async (probeSite) => await window.api.fetchBooru({ site: probeSite, viewType: 'new', limit: 3, cursor: null, search: probeSite.tags || '' })
            )
          );
        });
      };

      rerenderList();
      content.appendChild(list);

      const addRow = document.createElement('div');
      addRow.className = 'add-row';
      const addBtn = document.createElement('button');
      addBtn.textContent = 'Add Site';
      addBtn.className = 'btn-small';
      addBtn.addEventListener('click', () => {
        sites.push({ name: 'New Site', type: 'danbooru', baseUrl: '', rating: 'safe', tags: '', queryDialect: 'auto', credentials: {} });
        rerenderList();
      });
      addRow.appendChild(addBtn);
      content.appendChild(addRow);

      panel.appendChild(content);

      const btns = document.createElement('div');
      btns.className = 'btns';

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';

      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = 'Save';

      const hide = function () {
        container.classList.add('hidden');
        container.setAttribute('aria-hidden', 'true');
        container.innerHTML = '';
        container.removeEventListener('click', backdropHandler, true);
        document.removeEventListener('keydown', escHandler, true);
        onClose?.();
      };

      const setBusy = function (busy) {
        save.disabled = busy;
        cancel.disabled = busy;
        save.textContent = busy ? 'Saving…' : 'Save';
      };

      const escHandler = function (e) { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); hide(); } };
      const backdropHandler = function (e) { if (e.target === container) hide(); };

      cancel.addEventListener('click', () => hide());
      save.addEventListener('click', async () => {
        setBusy(true);
        try {
          const sanitized = (sites || [])
            .filter((s) => (s.baseUrl || '').trim().length > 0)
            .map((s) => ({
              name: s.name?.trim() || s.baseUrl,
              baseUrl: s.baseUrl?.trim(),
              type: s.type || 'danbooru',
              rating: s.rating || 'any',
              tags: stripRatingTokens(s.tags || ''),
              queryDialect: s.queryDialect || s.query_dialect || 'auto',
              credentials: s.credentials || {}
            }));
          await onSave({ sites: sanitized });
          hide();
        } finally {
          setBusy(false);
        }
      });

      btns.appendChild(cancel);
      btns.appendChild(save);
      panel.appendChild(btns);

      container.appendChild(panel);

      document.addEventListener('keydown', escHandler, true);
      container.addEventListener('click', backdropHandler, true);
      setTimeout(() => container.focus(), 0);
    } catch (err) {
      console.error('renderSiteManager failed:', err);
      alert('Failed to open Manage Sites. See Console for details.');
    }
  };
})();
