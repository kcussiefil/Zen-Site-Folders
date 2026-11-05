// ==UserScript==
// @name         Zen Site Folders — header drop joins first
// @version      0.7.3
// @include      chrome://browser/content/browser.xhtml
// ==/UserScript==
(() => {
  'use strict';
  window.__zsfTopDrop?.destroy?.();
  const OWN = 'tab-group[data-zsf-site]:not([split-view-group])';
  let source = null, intent = null, cleanup = 0;
  const unclipNodes = new Set();
  const listeners = [];
  const bind = (name, fn) => { window.addEventListener(name, fn, true);listeners.push([name, fn]); };
  const own = g => !!g?.isConnected && g.matches?.(OWN) && !g.pinned && !g.isZenFolder;
  const ordinary = t => t?.isConnected && t.localName === 'tab' && !t.pinned &&
    !t.multiselected && !t.hasAttribute('zen-essential') && !t.group?.hasAttribute('split-view-group');
  function clearPaint(context = intent) {
    if (!context) return;
    context.group.removeAttribute('data-zsf-entry-first');
    context.group.style.removeProperty('--zsf-entry-room');
    context.paint = null;
  }
  function clearIntent() {
    clearPaint();
    if (intent) for (const undo of intent.undo.reverse()) undo();
    intent = null;
  }
  function reset() {
    clearTimeout(cleanup);cleanup = 0;clearIntent();
    for (const node of unclipNodes) {
      node.removeAttribute('data-zsf-drag-unclip');node.removeAttribute('data-zsf-drag-unclip-part');
    }
    unclipNodes.clear();
    source = null;
  }
  function rememberDragClips() {
    if (!own(source?.origin)) return;
    const stop = document.getElementById('navigator-toolbox');
    const remember = (node, host = null) => {
      if (!node || node.clientHeight <= 0 || node.scrollTop > 0 ||
          node.scrollHeight > node.clientHeight + 6) return;
      const css = window.getComputedStyle(node);
      if (!['auto','scroll','hidden','clip'].includes(css.overflowY) &&
          !/paint|strict|content/.test(css.contain)) return;
      node.setAttribute('data-zsf-drag-unclip','true');unclipNodes.add(node);
      if (host) { host.setAttribute('data-zsf-drag-unclip-part','true');unclipNodes.add(host); }
    };
    // Measure before the translated row itself grows scrollable overflow.
    // Preserve genuinely scrolling containers; allow the same overflow Zia
    // permits for a fitting list, including Zen's <=6px collapsed padding.
    for (let node = source.tab.parentNode; node && node !== stop && node !== document.documentElement;
         node = node.parentNode || node.host) {
      if (node.nodeType !== 1) continue;
      // Only release clips INSIDE the tab list. The workspace viewport must
      // continue clipping rows above the adjacent media controls, even if
      // its contents fitted before the drag started.
      if (node.localName === 'zen-workspace' || node.id === 'tabbrowser-arrowscrollbox' ||
          node.classList?.contains('workspace-arrowscrollbox')) break;
      remember(node);remember(node.shadowRoot?.querySelector?.('[part~="scrollbox"]'),node);
    }
  }
  function arm(group, tab) {
    if (!own(group) || !group.collapsed || !ordinary(tab) || tab.group === group) return null;
    clearIntent();
    const first = [...group.tabs].find(t => t !== tab && !t.hasAttribute('zen-empty-tab'));
    if (!first) return null; // The native empty-folder path already has one position.
    const context = { group, tab, first, workspace: window.gZenWorkspaces?.activeWorkspace,
      undo: [], accepted: false, attempted: false, committing: false, paint: null };
    const move = window.gBrowser.moveTabBefore;
    const box = group.querySelector(':scope > .tab-group-container');
    const insert = box?.insertBefore;
    if (typeof insert !== 'function') return null;
    context.land = () => {
      if (!context.accepted || context.attempted) return tab;
      context.attempted = true;
      if (!own(group) || !group.collapsed || !ordinary(tab) || first.group !== group || !first.isConnected ||
          context.workspace !== window.gZenWorkspaces?.activeWorkspace) return tab;
      const held = tab.hasAttribute('zia-landing') && tab.getBoundingClientRect();
      context.committing = true;
      try { move.call(window.gBrowser, tab, first); }
      finally { context.committing = false; }
      if (held) {
        tab.style.removeProperty('transform');const at = tab.getBoundingClientRect();
        tab.style.setProperty('transform', `translate(${held.left-at.left}px, ${held.top-at.top}px)`, 'important');
      }
      return tab;
    };
    const wrap = (host, key) => {
      if (!host || typeof host[key] !== 'function') return;
      const before = Object.getOwnPropertyDescriptor(host, key), original = host[key];
      if (before && !before.configurable) throw Error('Unwrappable header landing');
      const domMove = ['appendChild','insertBefore','before','after'].includes(key);
      const wrapped = function(node, ...args) {
        if (node !== tab) return original.call(this, node, ...args);
        if (!context.committing) return context.land();
        if (domMove) {
          // Gecko's native move first joins through group.appendChild, then
          // positions next to the anchor. Make its FIRST DOM insertion final.
          if (tab.parentElement === first.parentElement && tab.nextElementSibling === first) return tab;
          return insert.call(box, tab, first);
        }
        return original.call(this, node, ...args);
      };
      Object.defineProperty(host, key, {value:wrapped,writable:true,configurable:true});
      context.undo.push(() => {
        if (host[key] !== wrapped) return;
        if (before) Object.defineProperty(host, key, before);else delete host[key];
      });
    };
    try {
      for (const key of ['moveTabBefore','moveTabAfter','moveTabToExistingGroup','moveTabToEnd','ungroupTab']) wrap(window.gBrowser, key);
      for (const host of [group, group.querySelector(':scope > .tab-group-container')]) {
        wrap(host, 'appendChild');wrap(host, 'insertBefore');
        for (const row of [...(host?.children || [])]) { wrap(row, 'before');wrap(row, 'after'); }
      }
      intent = context;return context;
    } catch (e) { for (const undo of context.undo.reverse()) undo();return null; }
  }
  function headerTarget(event, requireSlot = true) {
    // Zia targets by the moving row's visual midpoint, not the DOM element
    // beneath the pointer (which may be the moving tab itself). Use its actual
    // preview owner; adding another translated slot changes both hit testing
    // and the apparent distance between the row and pointer.
    const slot = document.querySelector?.(OWN + '[zia-drop-slot]');
    if (requireSlot) return own(slot) && slot.collapsed && slot !== source?.origin ? slot : null;
    const direct = event.target?.closest?.('.tab-group-label-container');
    const group = direct?.parentElement || event.target?.closest?.(OWN);
    if (!own(group) || !group.collapsed || group === source?.origin) return null;
    const header = direct || group.querySelector(':scope > .tab-group-label-container');
    const r = group.getBoundingClientRect();
    if (!r) return null;
    // Only entry into a closed group previews first. Expanded groups and
    // same-group reordering stay entirely native.
    return event.clientX >= r.left && event.clientX <= r.right &&
      event.clientY >= r.top && event.clientY <= r.bottom + (intent?.group === group ? Number(intent.paint) || 0 : 0) ? group : null;
  }
  function down(event) {
    if (event.button !== 0) return;
    reset();const tab = event.target?.closest?.('tab.tabbrowser-tab');
    if (!ordinary(tab)) return;
    source = {tab, origin:tab.group, startTop:tab.getBoundingClientRect().top,
      workspace:window.gZenWorkspaces?.activeWorkspace};
    rememberDragClips();
    // Zia registers after deferred startup; run after its live capture handlers.
    for (const [type, fn] of [['dragover', over], ['drop', drop]]) {
      window.removeEventListener(type, fn, true);window.addEventListener(type, fn, true);
    }
  }
  function over(event) {
    if (!source || !document.documentElement.hasAttribute('zia-dragging-tab')) return;
    const group = headerTarget(event);
    if (!group) { clearIntent();return; }
    if (intent?.group !== group) arm(group, source.tab);
    if (intent) intent.lastPoint = {x:event.clientX,y:event.clientY};
  }
  function drop(event) {
    if (!intent) return;
    if (!intent.group.collapsed) { clearIntent();return; }
    const at = intent.lastPoint;
    const frozen = at && Math.abs(event.clientX-at.x)<3 && Math.abs(event.clientY-at.y)<3;
    const group = headerTarget(event, false) || (frozen ? intent.group : null);
    if (group !== intent.group) { clearIntent();return; }
    intent.accepted = true;clearPaint();intent.land();
    event.preventDefault();event.stopPropagation();
    // Keep the one-shot guard through Zia's already queued placement/fallback.
    cleanup = setTimeout(reset, 0);
  }
  const end = () => { if (!cleanup) reset(); };
  bind('mousedown', down);bind('dragover', over);bind('drop', drop);bind('dragend', end);
  bind('keydown', e => { if (e.key === 'Escape') reset(); });
  bind('ZenWorkspacesUIUpdate', reset);bind('unload', reset);
  window.__zsfTopDrop = { destroy() { reset();for (const [type, fn] of listeners) window.removeEventListener(type, fn, true);delete window.__zsfTopDrop; } };
})();
