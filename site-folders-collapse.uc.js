// ==UserScript==
// @name         Zen Site Folders — native Zen/Zia folder motion
// @version      0.5.7
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
  let queuedScan = false;
  const queuedGroups = new Set();
  let lastSelected = null;
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
    const state = { collapsed, selected, done: null, finished: false,
      deferredComplete: prior?.deferredComplete === true };
    states.set(group, state);
    // A selected-tab change inside an already-closed group is not an
    // expansion. The previous bridge started expand AND collapse together,
    // which raced over the same elements and broke Zia's spring, particularly
    // when an audio tab was already visible.
    //
    // Native 'folder-active' remains on the previously selected tab even
    // after browser selection moved. Zen considers it active alongside the
    // newly selected tab, leaving TWO rows visible (caught by native CI).
    // Retire only the former selected rows, preserving nested/folder state.
    if (collapsed && prior?.collapsed) {
      for (const tab of prior.selected) {
        if (selected.includes(tab) || !tab.isConnected) continue;
        if (tab.hasAttribute('folder-active')) {
          tab.removeAttribute('folder-active');
          tab.style.removeProperty('--zen-folder-indent');
        }
        // Removing folder-active alone is insufficient: Zen's previously
        // selected row can retain a natural height even after the native
        // collapse skips it. Retire its layout box immediately; if the user
        // reselects it, styleCleanup(newlySelected) restores native sizing.
        tab.style.setProperty('height', '0px');
        tab.style.setProperty('min-height', '0px');
        tab.style.setProperty('opacity', '0');
      }
      // The new selected tab may still have native height:0 / opacity:0 left
      // by the previous collapse; clear only its old inline native styles.
      const newlySelected = selected.filter(tab => !prior.selected.includes(tab));
      if (newlySelected.length) zen.styleCleanup?.(newlySelected);
    }
    if (collapsed && selected.length === 0 && group.hasAttribute('has-active')) {
      group.removeAttribute('has-active');
      group.activeTabs = [];
    }
    // Exactly one native animation path per state transition. Zia decorates
    // this same native path; no competing WAAPI timeline is introduced.
    const job = collapsed ? zen.animateCollapse(group) : zen.animateExpand(group);
    state.done = Promise.resolve(job).then(() => {
      if (dead || !ours(group) || states.get(group) !== state) return;
      // Zen's shared animation counter skips finalization for all but the
      // last concurrently animated group. Finish this group's native state
      // only after its own latest native animations have actually finished.
      const shown = [...group.tabs].some(tab => tab.selected || tab.multiselected ||
        tab.getAttribute('folder-active') === 'true');
      if (group.collapsed && !shown) group.groupContainer.hidden = true;
      else group.groupContainer.hidden = false;
      window.gBrowser?.tabContainer?._invalidateCachedVisibleTabs?.();
    }).catch(error => console.warn('[ZenSiteFoldersMotion]', error)).finally(() => {
      if (dead || !ours(group) || states.get(group) !== state) return;
      state.finished = true;
      if (state.deferredComplete) {
        state.deferredComplete = false;
        group.dispatchEvent(new window.CustomEvent('TabGroupAnimationComplete', { bubbles: true }));
      }
    });
  }
  function scan() {
    if (dead) return;
    const tabs = window.gBrowser?.tabContainer;
    if (!tabs) return;
    const groups = [...tabs.querySelectorAll(SELECTOR)];
    const spaces = new Set();
    for (const group of groups) {
      const space = group.closest?.('zen-workspace');
      if (space) spaces.add(space);
      sync(group);
    }
    // Do not affect native folders or Spaces without any ZSF-owned groups.
    for (const space of tabs.querySelectorAll('zen-workspace')) {
      const enabled = spaces.has(space);
      if (space.hasAttribute('data-zsf-scroll-stable') !== enabled)
        space.toggleAttribute('data-zsf-scroll-stable', enabled);
    }
    for (const group of states.keys()) if (!ours(group)) states.delete(group);
  }
  function scheduleGroupSync(group) {
    if (dead || !ours(group) || queuedGroups.has(group)) return;
    queuedGroups.add(group);
    // Run after all TabGroup* capture listeners, including Zia's motion
    // marker, have observed the event; still before its next paint.
    queueMicrotask(() => {
      queuedGroups.delete(group);
      if (!dead && ours(group)) sync(group);
    });
  }
  function scheduleScan() {
    if (queuedScan || dead) return;
    queuedScan = true;
    // Structural changes must settle before the next native paint and
    // before a restore/ungroup operation verifies tab visibility. Using
    // requestAnimationFrame delayed this under headless/background windows.
    queueMicrotask(() => {
      queuedScan = false;
      if (!dead) scan();
    });
  }
  function onMutations(records) {
    let structural = false;
    for (const record of records) {
      if (record.type === 'attributes' &&
          record.attributeName === 'collapsed' && ours(record.target)) {
        // Never scan every tab in the whole sidebar for a single folder.
        scheduleGroupSync(record.target);
      } else if (record.type === 'attributes' &&
                 (record.attributeName === 'selected' ||
                  record.attributeName === 'multiselected')) {
        // A selection change outside Site Folders is not structural.
        // It must not rescan all groups during normal/video tab switches.
        if (ours(record.target.group)) scheduleGroupSync(record.target.group);
      } else if (record.type === 'attributes' &&
                 record.attributeName === 'data-zsf-site' &&
                 ours(record.target)) {
        // Set the scroll guard immediately, not one animation frame late.
        record.target.closest?.('zen-workspace')?.setAttribute(
          'data-zsf-scroll-stable', 'true');
        structural = true;
      } else {
        structural = true;
      }
    }
    if (structural) scheduleScan();
  }
  function onAnimationComplete(event) {
    const group = event.target;
    const state = states.get(group);
    if (!ours(group) || !state || state.finished) return;
    // Ordinary groups report width-transition completion independently of
    // this bridge's native vertical animation. Keep Zen's auto-scroll guard
    // alive until that SAME vertical animation finishes. No scrollTop repair,
    // selection change, or suppression of wheel/drag scrolling is involved.
    state.deferredComplete = true;
    event.stopImmediatePropagation();
  }
  function onTabSelect(event) {
    const previous = lastSelected;
    const current = event?.target?.localName === 'tab' ?
      event.target : window.gBrowser?.selectedTab || null;
    lastSelected = current;
    // Only the previous and current owners can have changed active rows.
    // Remembered state catches workspace/restore transitions where a tab's
    // .group pointer has already changed by the time TabSelect fires.
    const affected = new Set([previous?.group, current?.group]);
    for (const [group, state] of states) {
      if (!group.collapsed) continue;
      if (state.selected.includes(previous) || state.selected.includes(current))
        affected.add(group);
    }
    for (const group of affected)
      if (ours(group) && group.collapsed) scheduleGroupSync(group);
  }
  function start() {
    const tabs = window.gBrowser?.tabContainer;
    if (!tabs || dead || observer) return;
    for (const version of ['031', '032', '033', '034', '035', '036'])
      window['__zsfCollapseV' + version]?.destroy?.();
    lastSelected = window.gBrowser?.selectedTab || null;
    clearLegacyFlags();
    bind(window, 'TabGroupCollapse', event => scheduleGroupSync(event.target), true);
    bind(window, 'TabGroupExpand', event => scheduleGroupSync(event.target), true);
    bind(window, 'TabSelect', onTabSelect, true);
    bind(window, 'TabGroupAnimationComplete', onAnimationComplete, true);
    observer = new MutationObserver(onMutations);
    observer.observe(tabs, { subtree: true, childList: true,
      attributes: true, attributeFilter: [
        'data-zsf-site', 'collapsed', 'selected', 'multiselected'
      ] });
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
    for (const space of window.gBrowser?.tabContainer?.querySelectorAll('zen-workspace') || [])
      space.removeAttribute('data-zsf-scroll-stable');
    for (const [node, type, fn, options] of listeners) node.removeEventListener(type, fn, options);
    queuedGroups.clear();
    states.clear();
    delete window.__zsfCollapseV037;
  }
  window.__zsfCollapseV037 = { version: '0.4.2', start, sync, whenIdle, prepareToMoveTabs, clearLegacyFlags, destroy };
  if (document.readyState === 'complete') start();
  else bind(window, 'load', start, { once: true });
  bind(window, 'unload', destroy, { once: true });
})();
