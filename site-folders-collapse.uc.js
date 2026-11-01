// ==UserScript==
// @name         Zen Site Folders — safe collapse settle
// @version      0.3.1
// @description  Finalize own ordinary groups after Zen/Zia's native collapse spring.
// @include      chrome://browser/content/browser.xhtml
// ==/UserScript==
(() => {
  'use strict';
  if (window.__zsfCollapseV031) return;

  const SELECTOR = 'tab-group[data-zsf-site]:not([split-view-group])';
  const SETTLED = 'data-zsf-collapse-settled';
  // Zia's existing folder spring lasts 420ms; allow 50ms for the final paint.
  const SETTLE_MS = 470;
  const pending = new Map();
  let started = false;
  let destroyed = false;
  let observer = null;

  const isOurs = group => !!group?.isConnected &&
    group?.matches?.(SELECTOR) && !group.isZenFolder && !group.pinned;
  const folded = group => group?.hasAttribute?.('collapsed') === true;

  function cancel(group) {
    const timer = pending.get(group);
    if (timer != null) clearTimeout(timer);
    pending.delete(group);
  }

  function sync(group, initial = false) {
    if (!isOurs(group)) return;
    cancel(group);
    if (!folded(group)) {
      group.removeAttribute(SETTLED);
      return;
    }
    if (initial || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      group.setAttribute(SETTLED, 'true');
      return;
    }
    // Keep the group free for Zen/Zia's own slide/spring until it finishes.
    group.removeAttribute(SETTLED);
    const timer = setTimeout(() => {
      pending.delete(group);
      if (!destroyed && isOurs(group) && folded(group))
        group.setAttribute(SETTLED, 'true');
    }, SETTLE_MS);
    pending.set(group, timer);
  }

  function onGroupEvent(event) {
    const group = event.target;
    if (!isOurs(group)) return;
    sync(group);
  }

  function scanChildren(node) {
    if (!node || node.nodeType !== 1) return;
    if (isOurs(node)) sync(node);
    for (const group of node.querySelectorAll?.(SELECTOR) || [])
      sync(group);
  }

  function start() {
    if (destroyed || started) return;
    const tabs = window.gBrowser?.tabContainer;
    if (!tabs) return;
    started = true;
    // Initial session-restored groups are already in their final state.
    for (const group of tabs.querySelectorAll(SELECTOR)) sync(group, true);
    window.addEventListener('TabGroupCollapse', onGroupEvent, true);
    window.addEventListener('TabGroupExpand', onGroupEvent, true);
    observer = new MutationObserver(changes => {
      for (const change of changes) {
        if (change.type === 'attributes' && isOurs(change.target)) {
          sync(change.target);
        } else if (change.type === 'childList') {
          for (const node of change.addedNodes || []) scanChildren(node);
        }
      }
    });
    observer.observe(tabs, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['collapsed']
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    observer?.disconnect();
    window.removeEventListener('TabGroupCollapse', onGroupEvent, true);
    window.removeEventListener('TabGroupExpand', onGroupEvent, true);
    for (const group of pending.keys()) cancel(group);
    for (const group of window.gBrowser?.tabContainer?.querySelectorAll?.(SELECTOR) || [])
      group.removeAttribute(SETTLED);
    if (window.__zsfCollapseV031 === api) delete window.__zsfCollapseV031;
  }

  const api = { start, destroy, sync, version: '0.3.1' };
  window.__zsfCollapseV031 = api;
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
  window.addEventListener('unload', destroy, { once: true });
})();
