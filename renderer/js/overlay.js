// Overlay stack: scroll lock, focus trapping, and closeTop() for Esc/Android back
(function () {
  'use strict';

  const stack = [];
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

  function focusables(root) {
    return [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
  }

  function applyBodyLock() {
    document.body.classList.toggle('overlay-open', stack.some((e) => e.lockScroll));
  }

  // Trap Tab inside the top-most overlay
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || stack.length === 0) return;
    const top = stack[stack.length - 1];
    if (!top.root || !top.trapFocus) return;
    const items = focusables(top.root);
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!top.root.contains(active)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }, true);

  // Register an open overlay; call the returned release() when it closes
  function open(id, { close, root = null, trapFocus = true, lockScroll = true } = {}) {
    const entry = {
      id,
      close: typeof close === 'function' ? close : () => {},
      root,
      trapFocus: !!root && trapFocus,
      lockScroll,
      previousFocus: document.activeElement,
      released: false
    };
    stack.push(entry);
    applyBodyLock();
    return () => release(entry);
  }

  function release(entry) {
    if (entry.released) return;
    entry.released = true;
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    applyBodyLock();
    const prev = entry.previousFocus;
    if (prev && typeof prev.focus === 'function' && document.contains(prev) && prev.getClientRects().length > 0) {
      try { prev.focus(); } catch {}
    }
  }

  function closeTop() {
    const top = stack[stack.length - 1];
    if (!top) return false;
    try { top.close(); } catch {}
    if (!top.released) release(top); // in case close() didn't release

    return true;
  }

  window.SBOverlay = {
    open,
    closeTop,
    isOpen: () => stack.length > 0,
    count: () => stack.length
  };
})();
