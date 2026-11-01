// ==UserScript==
// @name         Zen Site Folders — native Zen/Zia folder motion
// @version      0.3.9
// @description  Bridge ordinary site groups to Zen's folder animation entrypoints.
// @include      chrome://browser/content/browser.xhtml
// ==/UserScript==
(() => {
  'use strict';
  if (window.__zsfCollapseV037) return;
  const SELECTOR = 'tab-group[data-zsf-site]:not([split-view-group])';
  const states = new Map();
  const listeners = [];
  let observer, dead = false;
  const ours = group => group?.isConnected && group.matches?.(SELECTOR) &&
    !group.isZenFolder && !group.pinned;
  function bind(node, type, fn, options) {
    node?.addEventListener(type, fn, options);
    listeners.push([node, type, fn, options]);
  }
  function clearLegacyFlags() {
    for (const group of window.gBrowser?.tabContainer?.querySelectorAll(SELECTOR) || []) {
      group.removeAttribute('data-zsf-animating');
      group.removeAttribute('data-zsf-collapse-settled');
    }
  }
  // Only copy the state accessors required by the native animation routines.
  // Do not change the element's type, isZenFolder, pinned state or tab objects.
  function prepare(group) {
    const proto = window.customElements?.get('zen-folder')?.prototype;
    if (!proto) return false;
    for (const key of ['activeGroups', 'childActiveGroups', 'activeTabs']) {
      if (key in group) continue;
      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      if (!descriptor) return false;
      Object.defineProperty(group, key, { ...descriptor, configurable: true });
    }
    group._activeTabs ??= [];
    return true;
  }
  function sync(group, force = false) {
    if (dead || !ours(group) || !prepare(group)) return;
    const zen = window.gZenFolders;
    if (typeof zen?.animateCollapse !== 'function' ||
        typeof zen?.animateExpand !== 'function') return;
    const collapsed = group.collapsed;
    const selected = [...group.tabs].filter(tab => tab.selected || tab.multiselected);
    const prior = states.get(group);
    if (!force && prior && prior.collapsed === collapsed &&
        prior.selected.length === selected.length &&
        prior.selected.every((tab, i) => tab === selected[i])) return;
    const state = { collapsed, selected, done: null };
    states.set(group, state);
    // Zen's public event handlers skip ordinary tab-group. Its animation
    // methods use the same native animation registry that Zia decorates.
    // On selection, reveal the new active row and collapse the other rows
    // through that registry; replacement cancels each old item animation.
    const jobs = [];
    if (!collapsed || prior?.collapsed) jobs.push(zen.animateExpand(group));
    if (collapsed) jobs.push(zen.animateCollapse(group));
    state.done = Promise.all(jobs).then(() => {
      if (dead || !ours(group) || states.get(group) !== state) return;
      // Zen's shared animation counter skips finalization for all but the
      // last concurrently animated group. Finish this group's native state
      // only after its own latest native animations have actually finished.
      const shown = [...group.tabs].some(tab => tab.selected || tab.multiselected ||
        tab.getAttribute('folder-active') === 'true');
      if (group.collapsed && !shown) group.groupContainer.hidden = true;
      else group.groupContainer.hidden = false;
      window.gBrowser?.tabContainer?._invalidateCachedVisibleTabs?.();
    }).catch(error => console.warn('[ZenSiteFoldersMotion]', error));
  }
  function scan() {
    clearLegacyFlags();
    for (const group of window.gBrowser?.tabContainer?.querySelectorAll(SELECTOR) || []) sync(group);
    for (const group of states.keys()) if (!ours(group)) states.delete(group);
  }
  function start() {
    const tabs = window.gBrowser?.tabContainer;
    if (!tabs || dead || observer) return;
    // Retire older live controllers before removing their state attributes.
    for (const version of ['031', '032', '033', '034', '035', '036'])
      window['__zsfCollapseV' + version]?.destroy?.();
    bind(window, 'TabGroupCollapse', event => sync(event.target), true);
    bind(window, 'TabGroupExpand', event => sync(event.target), true);
    bind(window, 'TabSelect', () => {
      for (const group of tabs.querySelectorAll(SELECTOR)) if (group.collapsed) sync(group);
    }, true);
    observer = new MutationObserver(scan);
    observer.observe(tabs, { subtree: true, childList: true,
      attributes: true, attributeFilter: ['data-zsf-site', 'collapsed'] });
    scan();
  }
  async function whenIdle(group) {
    // Re-read after each completion: rapid reversals replace the state.
    for (let state; (state = states.get(group));) {
      await state.done;
      if (states.get(group) === state) return;
    }
  }
  async function prepareToMoveTabs(groups) {
    const owned = [...new Set(groups)].filter(ours);
    // Native collapse writes height/opacity onto the actual tab elements.
    // Finish a native expansion BEFORE reparenting, while those elements
    // are still available to the native animation registry for cleanup.
    for (const group of owned) {
      group.collapsed = false;
      sync(group, true);
    }
    await Promise.all(owned.map(whenIdle));
    return owned.every(group => !group.collapsed && [...group.tabs].every(tab => {
      const style = window.getComputedStyle(tab);
      return tab.getBoundingClientRect().height > 0 && Number(style.opacity) > 0;
    }));
  }
  function destroy() {
    dead = true;
    observer?.disconnect();
    for (const [node, type, fn, options] of listeners) node.removeEventListener(type, fn, options);
    states.clear();
    delete window.__zsfCollapseV037;
  }
  window.__zsfCollapseV037 = { version: '0.3.9', start, sync, whenIdle, prepareToMoveTabs, clearLegacyFlags, destroy };
  if (document.readyState === 'complete') start();
  else bind(window, 'load', start, { once: true });
  bind(window, 'unload', destroy, { once: true });
})();
