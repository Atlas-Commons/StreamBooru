(function () {
  const notify = (msg, opts) => { if (typeof window.toast === 'function') window.toast(msg, opts); else alert(msg); };
  const notifyError = (msg) => notify(msg, { type: 'error' });
  const notifySuccess = (msg) => notify(msg, { type: 'success' });

  // elements
  function h(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach((c) => { if (c) el.appendChild(c); });
    return el;
  }

  // styles
  function ensureStyles() {
    const id = 'account-modal-fix-styles';
    if (document.getElementById(id)) return;
    const css = `
      #account-manager .site-card .actions-row { position: relative; z-index: auto; }
      #account-manager .site-card .fields-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      #account-manager input, #account-manager select, #account-manager textarea { pointer-events: auto; user-select: text; }
      #account-manager .panel { outline: none; }
      #account-manager .badge { display:inline-block; padding:2px 6px; border-radius:999px; font-size:11px; line-height:1.6; border:1px solid rgba(255,255,255,0.15); margin-left:6px;}
      #account-manager .badge.ok { color:#52d273; border-color: rgba(82,210,115,0.35); }
      #account-manager .badge.err { color:#ff6b6b; border-color: rgba(255,107,107,0.35); }
      #account-manager .badge.muted { color:#a9b0c0; }
    `;
    const style = document.createElement('style');
    style.id = id;
    style.type = 'text/css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // helpers
  function ensureOption(selectEl, value, label) {
    if (!value) return;
    const val = String(value).replace(/\/+$/,'');
    const exists = Array.from(selectEl.options).some(o => o.value.replace(/\/+$/,'') === val);
    if (!exists) {
      const opt = h('option');
      opt.value = val;
      try {
        const host = new URL(val).host || val;
        opt.textContent = label || host;
      } catch {
        opt.textContent = label || val;
      }
      selectEl.appendChild(opt);
    }
  }

  function mkInput(ph, type = 'text') {
    const i = document.createElement('input');
    i.type = type;
    i.placeholder = ph;
    i.autocomplete = 'off';
    i.autocapitalize = 'off';
    i.spellcheck = false;
    i.tabIndex = 0;
    i.style.pointerEvents = 'auto';
    i.addEventListener('keydown', (e) => e.stopPropagation(), true);
    i.addEventListener('keypress', (e) => e.stopPropagation(), true);
    i.addEventListener('keyup', (e) => e.stopPropagation(), true);
    return i;
  }

  // modal
  async function openAccountModal() {
    ensureStyles();

    const root = document.getElementById('account-manager');
    if (!root) return;

    root.innerHTML = '';
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('tabindex', '-1');

    const panel = h('div', { className: 'panel' });
    const title = h('h2', { text: 'Account' });

    const content = h('div', { className: 'content-scroll' });
    const card = h('div', { className: 'site-card compact' });
    const status = h('div', { className: 'hint' });

    // server
    const serverRow = h('div', { className: 'actions-row' });
    const serverLabel = h('label', { text: 'Server' });
    const serverSelect = h('select');
    const SERVERS = [
      ['https://streambooru.ecchibooru.uk','streambooru.ecchibooru.uk']
    ];
    SERVERS.forEach(([val, label]) => {
      const opt = h('option'); opt.value = val; opt.textContent = label; serverSelect.appendChild(opt);
    });
    const btnUseServer = h('button', { className: 'link-btn', text: 'Use Server' });
    serverRow.appendChild(serverLabel);
    serverRow.appendChild(serverSelect);
    serverRow.appendChild(btnUseServer);

    // create
    const rowRegister = h('div', { className: 'fields-row' });
    const regUser = mkInput('New username', 'text');
    const regPass = mkInput('New password', 'password');
    const btnRegister = h('button', { className: 'link-btn accent', text: 'Create Account' });
    rowRegister.appendChild(regUser); rowRegister.appendChild(regPass); rowRegister.appendChild(btnRegister);

    // local login
    const rowLocal = h('div', { className: 'fields-row' });
    const userInput = mkInput('Username', 'text');
    const passInput = mkInput('Password', 'password');
    const btnLoginLocal = h('button', { className: 'link-btn', text: 'Login (Local)' });
    rowLocal.appendChild(userInput); rowLocal.appendChild(passInput); rowLocal.appendChild(btnLoginLocal);

    // oauth/link/logout
    const rowDiscord = h('div', { className: 'actions-row' });
    const btnLinkDiscord = h('button', { className: 'link-btn', text: 'Link Discord' });
    const btnLoginDiscord = h('button', { className: 'link-btn', type: 'button', text: 'Login with Discord' });
    const btnUnlinkDiscord = h('button', { className: 'link-btn', text: 'Unlink Discord' });
    const btnLogout = h('button', { className: 'link-btn', text: 'Logout' });
    const linkBadge = h('span', { className: 'badge muted', text: '' });
    rowDiscord.appendChild(btnLinkDiscord);
    rowDiscord.appendChild(btnLoginDiscord);
    rowDiscord.appendChild(btnUnlinkDiscord);
    rowDiscord.appendChild(btnLogout);
    rowDiscord.appendChild(linkBadge);

    // manual sync
    const rowInfo = h('div', { className: 'actions-row' });
    const btnPullFav = h('button', { className: 'link-btn', text: 'Sync favourites (manual)' });
    rowInfo.appendChild(btnPullFav);

    card.appendChild(status);
    card.appendChild(serverRow);
    card.appendChild(rowRegister);
    card.appendChild(rowLocal);
    card.appendChild(rowDiscord);
    card.appendChild(rowInfo);
    content.appendChild(card);

    const btns = h('div', { className: 'btns' });
    const closeBtn = h('button', { text: 'Close' });
    btns.appendChild(closeBtn);

    panel.appendChild(title);
    panel.appendChild(content);
    panel.appendChild(btns);
    root.appendChild(panel);

    // events
    const escHandler = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    const backdropHandler = (e) => { if (e.target === root) close(); };

    // account change event (Discord deep link returns, logout, etc.)
    let stopAccountWatch = null;
    let releaseOverlay = null;
    const onAccountChanged = async () => { try { await refresh(); } catch {} };

    function close() {
      document.removeEventListener('keydown', escHandler, true);
      root.removeEventListener('click', backdropHandler, true);
      try { window.events?.off?.('account_changed', onAccountChanged); } catch {}
      try { if (typeof stopAccountWatch === 'function') stopAccountWatch(); } catch {}
      root.classList.add('hidden');
      root.setAttribute('aria-hidden', 'true');
      root.innerHTML = '';
      releaseOverlay?.();
      releaseOverlay = null;
    }
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', escHandler, true);
    root.addEventListener('click', backdropHandler, true);
    releaseOverlay = window.SBOverlay?.open?.('account', { close, root }) || null;
    window.events?.on?.('account_changed', onAccountChanged);

    // auto-persist server on change
    serverSelect.addEventListener('change', async () => {
      await window.api.accountSetServer?.(serverSelect.value);
      await refresh();
    });

    async function refresh() {
      const a = await (window.api.accountGet?.() || {});
      const origin = (typeof window !== 'undefined' && window.location?.origin)
        ? window.location.origin.replace(/\/+$/, '')
        : '';
      if (origin) {
        let label = origin;
        try { label = `${new URL(origin).host} (this server)`; } catch {}
        ensureOption(serverSelect, origin, label);
      }
      const curRaw = String(a.serverBase || '').trim();
      const cur = curRaw.replace(/\/+$/,'');
      if (cur) ensureOption(serverSelect, cur);
      if (cur && Array.from(serverSelect.options).some(o => o.value.replace(/\/+$/,'') === cur)) {
        serverSelect.value = cur;
      } else if (origin) {
        serverSelect.value = origin;
      } else if (cur.includes('.ecchibooru.')) {
        serverSelect.value = 'https://streambooru.ecchibooru.uk';
      } else {
        serverSelect.value = 'https://streambooru.ecchibooru.uk';
      }

      // default server if none persisted
      if (!a.serverBase) {
        await window.api.accountSetServer?.(origin || serverSelect.value);
      }

      const who = a.user ? (a.user.name || a.user.id) : null;
      status.textContent = a.loggedIn
        ? `Server: ${serverSelect.value} • Logged in${who ? ' as ' + who : ''}`
        : `Server: ${serverSelect.value} • Not logged in`;

      const linked = !!a?.user?.discord_id;
      linkBadge.textContent = linked ? 'Discord linked' : (a.loggedIn ? 'Signed in' : 'Discord not linked');
      linkBadge.className = 'badge ' + (linked ? 'ok' : (a.loggedIn ? 'ok' : 'muted'));

      btnLinkDiscord.disabled = !a.loggedIn || linked;
      btnLoginDiscord.disabled = !serverSelect.value || a.loggedIn;
      btnLoginDiscord.title = a.loggedIn ? 'You are already logged in' : 'Sign in with Discord';
      btnUnlinkDiscord.disabled = !a.loggedIn || !linked;
      btnLoginLocal.disabled = !serverSelect.value || a.loggedIn;
      btnRegister.disabled = !serverSelect.value || a.loggedIn;
      btnLogout.disabled = !a.loggedIn;
      btnPullFav.disabled = !a.loggedIn;

      setTimeout(() => {
        if (!a.loggedIn) regUser.focus();
        else if (!linked) btnLinkDiscord.focus();
        else userInput.focus();
      }, 0);
    }

    function startAccountWatch({ stopWhenLoggedIn = true, maxMs = 60000, intervalMs = 1500 } = {}) {
      let cancelled = false;
      const t0 = Date.now();
      async function tick() {
        if (cancelled) return;
        try {
          const a = await (window.api.accountGet?.() || {});
          await refresh();
          if ((stopWhenLoggedIn && a?.loggedIn) || (Date.now() - t0 > maxMs)) { cancelled = true; return; }
        } catch {}
        if (!cancelled) setTimeout(tick, intervalMs);
      }
      setTimeout(tick, intervalMs);
      return () => { cancelled = true; };
    }

    btnUseServer.addEventListener('click', async () => {
      await window.api.accountSetServer?.(serverSelect.value);
      await refresh();
    });

    btnRegister.addEventListener('click', async () => {
      try {
        btnRegister.disabled = true;
        const u = regUser.value.trim();
        const p = regPass.value;
        if (!u || !p) { notifyError('Enter username and password'); return; }
        await window.api.accountSetServer?.(serverSelect.value);
        const res = await window.api.accountRegister?.(u, p);
        if (!res?.ok) notifyError('Register failed' + (res?.error ? `: ${res.error}` : ''));
        else { await window.api.syncOnLogin?.(); notifySuccess('Account created and synced.'); }
      } finally { btnRegister.disabled = false; await refresh(); }
    });

    btnLoginLocal.addEventListener('click', async () => {
      try {
        btnLoginLocal.disabled = true;
        const u = userInput.value.trim();
        const p = passInput.value;
        if (!u || !p) { notifyError('Enter username and password'); return; }
        await window.api.accountSetServer?.(serverSelect.value);
        const res = await window.api.accountLoginLocal?.(u, p);
        if (!res?.ok) notifyError('Login failed' + (res?.error ? `: ${res.error}` : ''));
        else { await window.api.syncOnLogin?.(); notifySuccess('Login complete. Synced.'); }
      } finally { btnLoginLocal.disabled = false; await refresh(); }
    });

    btnLinkDiscord.addEventListener('click', async () => {
      try {
        btnLinkDiscord.disabled = true;
        const res = await window.api.accountLinkDiscord?.();
        if (!res?.ok) {
          notifyError('Link start failed' + (res?.error ? `: ${res.error}` : ''));
        } else {
          if (res.linked) {
            notifySuccess('Discord account linked.');
          } else {
            notify('Continue the Discord consent in your browser to complete linking.');
            try { if (typeof stopAccountWatch === 'function') stopAccountWatch(); } catch {}
            stopAccountWatch = startAccountWatch({ stopWhenLoggedIn: false, maxMs: 60000, intervalMs: 1500 });
          }
        }
      } finally { btnLinkDiscord.disabled = false; await refresh(); }
    });

    btnUnlinkDiscord.addEventListener('click', async () => {
      try {
        btnUnlinkDiscord.disabled = true;
        const res = await window.api.accountUnlinkDiscord?.();
        if (!res?.ok) notifyError('Unlink failed' + (res?.error ? `: ${res.error}` : ''));
        else { notifySuccess('Discord unlinked.'); }
      } finally { btnUnlinkDiscord.disabled = false; await refresh(); }
    });

    btnLoginDiscord.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btnLoginDiscord.disabled) return;
      btnLoginDiscord.disabled = true;
      try {
        const onWeb = typeof window !== 'undefined'
          && window.location.pathname.startsWith('/app')
          && !navigator.userAgent.includes('Electron');
        const res = onWeb
          ? (window.api.accountBeginDiscordLogin?.() || { ok: false, error: 'Login unavailable' })
          : null;
        if (onWeb) {
          if (!res?.ok) {
            notifyError('Login failed' + (res?.error ? `: ${res.error}` : ''));
            btnLoginDiscord.disabled = false;
            return;
          }
          status.textContent = 'Redirecting to Discord…';
          try { if (typeof stopAccountWatch === 'function') stopAccountWatch(); } catch {}
          stopAccountWatch = startAccountWatch({ stopWhenLoggedIn: true, maxMs: 120000, intervalMs: 1500 });
          return;
        }
        (async () => {
          try {
            const asyncRes = await window.api.accountLoginDiscord?.();
            if (!asyncRes?.ok) notifyError('Login failed' + (asyncRes?.error ? `: ${asyncRes.error}` : ''));
            else {
              notify('Follow the browser flow; you’ll return to the app automatically.');
              try { if (typeof stopAccountWatch === 'function') stopAccountWatch(); } catch {}
              stopAccountWatch = startAccountWatch({ stopWhenLoggedIn: true, maxMs: 60000, intervalMs: 1500 });
            }
          } finally {
            btnLoginDiscord.disabled = false;
            await refresh();
          }
        })();
      } catch (err) {
        notifyError('Login failed: ' + (err?.message || err));
        btnLoginDiscord.disabled = false;
      }
    });

    btnLogout.addEventListener('click', async () => {
      await window.api.accountLogout?.();
      notify('Logged out');
      await refresh();
    });

    btnPullFav.addEventListener('click', async () => {
      const res = await window.api.syncPullFavorites?.();
      if (res?.ok) notifySuccess(`Favourites synced.${res.pushed ? ` ${res.pushed} local fave${res.pushed === 1 ? '' : 's'} uploaded.` : ''}`);
      else notifyError('Sync failed' + (res?.error ? `: ${res.error}` : ''));
    });

    await refresh();
    setTimeout(() => panel.focus(), 0);
  }

  // hook (mnu-account is forwarded to btn-account by the mobile menu)
  function setupAccountButton() {
    const btn = document.getElementById('btn-account');
    if (btn) btn.addEventListener('click', openAccountModal);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupAccountButton);
  } else {
    setupAccountButton();
  }
})();