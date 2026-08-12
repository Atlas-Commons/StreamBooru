// window.toast(message, { type: 'info'|'success'|'error', duration, actionLabel, onAction })
(function () {
  'use strict';

  let container = null;

  function ensureContainer() {
    if (container && document.body.contains(container)) return container;
    container = document.createElement('div');
    container.id = 'toast-container';
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(container);
    return container;
  }

  function dismiss(el) {
    if (!el.isConnected) return;
    el.classList.add('toast--leaving');
    setTimeout(() => el.remove(), 180);
  }

  function toast(message, { type = 'info', duration, actionLabel = '', onAction = null } = {}) {
    const host = ensureContainer();
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const text = document.createElement('div');
    text.className = 'toast-text';
    text.textContent = String(message ?? '');
    el.appendChild(text);

    if (actionLabel && typeof onAction === 'function') {
      const btn = document.createElement('button');
      btn.className = 'toast-action';
      btn.textContent = actionLabel;
      btn.addEventListener('click', () => { try { onAction(); } finally { dismiss(el); } });
      el.appendChild(btn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.textContent = '\u2715';
    closeBtn.addEventListener('click', () => dismiss(el));
    el.appendChild(closeBtn);

    host.appendChild(el);
    while (host.children.length > 4) host.firstElementChild.remove();

    const ms = Number.isFinite(duration) ? duration : (type === 'error' ? 7000 : 3800);
    if (ms > 0) {
      let timer = setTimeout(() => dismiss(el), ms);
      el.addEventListener('pointerenter', () => { clearTimeout(timer); });
      el.addEventListener('pointerleave', () => { timer = setTimeout(() => dismiss(el), 1500); });
    }
    return { dismiss: () => dismiss(el), element: el };
  }

  window.toast = toast;
  window.toastError = (msg, opts = {}) => toast(msg, { ...opts, type: 'error' });
  window.toastSuccess = (msg, opts = {}) => toast(msg, { ...opts, type: 'success' });
})();
