// ==UserScript==
// @name         Zen Site Folders — native Zen/Zia folder motion
// @version      0.6.6
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
  const deferredRows = new Map();
  let sidebarObserver;
  function retireHiddenRows() {
    if (dead || !deferredRows.size) return;
    const root = document.documentElement;
    const toolbox = document.getElementById?.('navigator-toolbox');
    const titlebar = toolbox?.querySelector('#titlebar');
    const drag = window.__zsfDragV037?.debugDrag?.();
    if (root.getAttribute('zen-compact-mode') !== 'true' || !titlebar ||
        toolbox.matches(':hover') || toolbox.hasAttribute('data-zsf-preview-sidebar-hold') ||
        grab?.dragging || root.hasAttribute('zia-dragging-tab') ||
        drag?.activeKind || drag?.ziaDelegate ||
        window.getComputedStyle(titlebar).visibility !== 'hidden') return;
    // Zen hides #titlebar and translates its toolbox on separate CSS
    // transitions. Both must finish, including when hover cancels the hide.
    if (toolbox.getAnimations().some(animation =>
      ['running', 'pending'].includes(animation.playState) &&
      ['translate', 'visibility'].includes(animation.transitionProperty))) return;
    for (const group of deferredRows.keys()) {
      deferredRows.delete(group);
      if (ours(group) && group.collapsed && window.gBrowser.selectedTab?.group !== group)
        sync(group, false, 'hidden-sidebar');
    }
  }
  let grab = null;
  function clearGrab() {
    document.documentElement?.removeAttribute?.('data-zsf-grab-pending');
    if (grab?.tab) {
      grab.tab.removeAttribute('data-zsf-grab-offset');
      grab.tab.style.removeProperty('--zsf-native-grab-offset');
    }
    grab = null;
  }
  function scrollAnchor(group) {
    const tab = window.gBrowser?.selectedTab;
    const space = group.closest?.('zen-workspace');
    const port = space?.scrollbox?.scrollbox;
    if (!tab?.isConnected || tab.group === group || !space ||
        tab.closest?.('zen-workspace') !== space || !port?.getBoundingClientRect ||
        !tab.getBoundingClientRect) return null;
    const y = tab.getBoundingClientRect().top, box = port.getBoundingClientRect();
    if (y < box.top || y >= box.bottom) return null;
    // A may retire immediately at the absolute top. A potential drag keeps
    // the clicked row anchored until mouseup distinguishes click from drag.
    const keep = port.scrollTop > .5;
    if (!keep && grab?.tab !== tab) return null;
    return () => {
      if (!tab.isConnected || window.gBrowser.selectedTab !== tab) return;
      const delta = tab.getBoundingClientRect().top - y;
      if (keep && Math.abs(delta) > .1) {
        const top = port.scrollTop + delta;
        if (typeof port.scrollTo === 'function') port.scrollTo({top,behavior:'instant'});
        else port.scrollTop = top;
      }
      // A is already gone. Preserve only the actual grabbed row's visual
      // position until click/drag is known, before Zia measures dragstart.
      const missing = y - tab.getBoundingClientRect().top;
      if (grab?.tab === tab && missing > .5) {
        grab.tab.setAttribute('data-zsf-grab-offset','true');
        grab.tab.style.setProperty('--zsf-native-grab-offset', missing + 'px');
        document.documentElement.setAttribute('data-zsf-grab-pending','true');
      }

    };
  }
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
  // Keep the element's type, pinned state and actual tab objects intact.
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
  function sync(group, force = false, membership = null) {
    if (dead || !ours(group) || !prepare(group)) return;
    const zen = window.gZenFolders;
    if (typeof zen?.animateCollapse !== 'function' ||
        typeof zen?.animateExpand !== 'function') return;
    const collapsed = group.collapsed;
    const members = [...group.tabs];
    const selected = members.filter(tab => tab.selected || tab.multiselected);
    const prior = states.get(group);
    const held = deferredRows.get(group);
    if (held && (!collapsed || selected.length || !members.includes(held)))
      deferredRows.delete(group);
    else if (held && prior?.collapsed && !membership &&
             prior.members.length === members.length &&
             prior.members.every((tab, i) => tab === members[i])) return;
    const clearStranded = tab => {
      if (!tab?.isConnected || tab.pinned ||
          (tab.group && (!ours(tab.group) || tab.group.collapsed))) return;
      const style = tab.style;
      if (style?.getPropertyValue?.('height') !== '0px' ||
          style.getPropertyValue('opacity') !== '0' ||
          (tab.getAnimations?.() || []).some(a => a.playState === 'running' || a.pending)) return;
      zen.styleCleanup?.([tab]);
      tab.removeAttribute?.('folder-active');
      tab.removeAttribute?.('zia-kept-tab');
    };
    for (const tab of prior?.members || [])
      if (!members.includes(tab)) clearStranded(tab);
    if (!collapsed) for (const tab of members)
      if (!prior?.members?.includes(tab)) clearStranded(tab);
    if (!force && prior && prior.collapsed === collapsed &&
        prior.members.length === members.length &&
        prior.members.every((tab, i) => tab === members[i]) &&
        prior.selected.length === selected.length &&
        prior.selected.every((tab, i) => tab === selected[i])) return;
    const state = { collapsed, selected, members, done: null, finished: false,
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
    const oldActive = (group.activeTabs || []).some(tab =>
      members.includes(tab) && tab.isConnected && tab.hasAttribute('folder-active'));
    const retiring = collapsed && !selected.length && oldActive;
    const restoreAnchor = retiring && membership !== 'hidden-sidebar' ? scrollAnchor(group) : null;
    if (collapsed && prior?.collapsed) {
      // Retire old native rows after the sidebar hides or the group changes.
      for (const tab of new Set([...prior.selected, ...(group.activeTabs || [])])) {
        // A former selection may already belong to another group or be standalone.
        // Never retire an element after it has left this group's membership.
        if (selected.includes(tab) || !tab.isConnected || !members.includes(tab)) continue;
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
    let job;
    if (retiring || (membership === 'leave' && collapsed && !selected.length && !group.activeTabs.length)) {
      // The dragged active row has already left this closed group. Its other
      // rows are hidden already; a second collapse would animate the empty
      // container's margin and move every following group after the landing.
      group.groupContainer.hidden = true;
      group.groupStartElement?.style.removeProperty('margin-top');
      window.gBrowser?.tabContainer?._invalidateCachedVisibleTabs?.();
      restoreAnchor?.();
      job = Promise.resolve();
    } else if (membership === 'join' && collapsed && selected.length && typeof zen.animateSelect === 'function') {
      // TabGrouped is synchronous. Establish the native selected-row layout
      // BEFORE Zia measures the landing, rather than collapsing natural-height
      // siblings a microtask later. Pre-register selection so native Zen keeps
      // even an all-selected group closed during this membership operation.
      for (const tab of members) if (!selected.includes(tab)) {
        tab.removeAttribute('folder-active');
        tab.style.removeProperty('--zen-folder-indent');
      }
      group.setAttribute('has-active', 'true');
      group.activeTabs = selected;
      // A closed group's start spacer can still carry the negative height of
      // its entire hidden list. The dropped row is already at its preview:
      // do not animate that old spacer height while Zia animates the landing.
      const start = group.groupStartElement;
      for (const animation of start?.getAnimations?.() || []) {
        if (animation.effect?.getKeyframes?.().some(frame => 'marginTop' in frame)) animation.cancel();
      }
      if (start) start.style.setProperty('margin-top', '0px');
      group.groupContainer.hidden = false;
      // Native animateSelect's sole entry gate requires this capability. Its
      // synchronous portion supplies visibility, sizing and native animations.
      // Restore BEFORE any native membership listener runs; no DOM move, pin
      // operation, or persistent folder conversion occurs under this flag.
      const descriptor = Object.getOwnPropertyDescriptor(group, 'isZenFolder');
      try {
        Object.defineProperty(group, 'isZenFolder', { value: true, configurable: true });
        job = zen.animateSelect(group);
      } finally {
        if (descriptor) Object.defineProperty(group, 'isZenFolder', descriptor);
        else delete group.isZenFolder;
      }
      window.gBrowser?.tabContainer?._invalidateCachedVisibleTabs?.();
    } else job = collapsed ? zen.animateCollapse(group) : zen.animateExpand(group);
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
    for (const group of states.keys()) if (!ours(group)) {
      states.delete(group);
      deferredRows.delete(group);
    }
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
      if (record.type === 'childList') {
        scheduleGroupSync(record.target.closest?.(SELECTOR));
        for (const nodes of [record.addedNodes, record.removedNodes]) {
          for (const node of nodes) {
            if (node.matches?.(SELECTOR) || node.querySelector?.(SELECTOR)) {
              structural = true;
              break;
            }
          }
          if (structural) break;
        }
      } else if (record.attributeName === 'data-zsf-site') {
        const group = record.target;
        if (ours(group)) {
          group.closest?.('zen-workspace')?.setAttribute('data-zsf-scroll-stable', 'true');
          structural = true;
        } else if (states.has(group)) {
          structural = true;
        }
      } else if (record.attributeName === 'collapsed') {
        scheduleGroupSync(record.target);
      } else {
        scheduleGroupSync(record.target.group);
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
    const oldGroup = previous?.group;
    if (current && current.group !== oldGroup && ours(oldGroup) && oldGroup.collapsed &&
        previous.hasAttribute('folder-active')) {
      deferredRows.set(oldGroup, previous);
      queueMicrotask(retireHiddenRows);
    }
    deferredRows.delete(current?.group);
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
  function onTabGrouped(event) {
    const tab = event.detail, group = tab?.group;
    if (!ours(group) || !group.collapsed || !(tab.selected || tab.multiselected)) return;
    sync(group, true, 'join');
  }
  function onTabUngrouped(event) {
    const group = event.target, tab = event.detail;
    if (!ours(group) || !tab || tab.group === group || !prepare(group)) return;
    // A departing active row is already in its new DOM position. Letting the
    // old owner's native unload animate it would hide/move that same row again.
    tab.removeAttribute('folder-active');
    tab.removeAttribute('zia-kept-tab');
    tab.style.removeProperty('--zen-folder-indent');
    window.gZenFolders?.styleCleanup?.([tab]);
    group.activeTabs = (group.activeTabs || []).filter(member => member !== tab);
    sync(group, true, 'leave');
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
    bind(window, 'TabGrouped', onTabGrouped, true);
    bind(window, 'TabUngrouped', onTabUngrouped, true);
    bind(window, 'TabGroupAnimationComplete', onAnimationComplete, true);
    bind(window, 'mousedown', event => {
      if (event.button !== 0) return;
      clearGrab();
      const tab = event.target?.closest?.('tab.tabbrowser-tab');
      if (tab?.isConnected && !tab.pinned && !tab.multiselected)
        grab = {tab,dragging:false};
    }, true);
    bind(window, 'dragstart', () => {
      if (grab) grab.dragging = true;
      queueMicrotask(() => document.documentElement.removeAttribute('data-zsf-grab-pending'));
    }, true);
    bind(window, 'mouseup', () => { if (!grab?.dragging) clearGrab(); }, true);
    bind(window, 'dragend', () => {
      clearGrab();
      queueMicrotask(retireHiddenRows);
    }, true);
    const toolbox = document.getElementById?.('navigator-toolbox');
    if (toolbox) {
      const onSidebarTransition = event => {
        if ((event.target === toolbox || event.target.id === 'titlebar') &&
            ['translate', 'visibility'].includes(event.propertyName)) retireHiddenRows();
      };
      bind(toolbox, 'transitionend', onSidebarTransition);
      bind(toolbox, 'transitioncancel', onSidebarTransition);
      sidebarObserver = new MutationObserver(retireHiddenRows);
      sidebarObserver.observe(toolbox, { attributes: true, attributeFilter: [
        'zen-has-hover', 'zen-user-show', 'zen-compact-mode-active', 'flash-popup',
        'data-zsf-preview-sidebar-hold', 'has-popup-menu', 'movingtab', 'animate'
      ] });
      sidebarObserver.observe(document.documentElement, { attributes: true,
        attributeFilter: ['zen-compact-mode', 'zia-dragging-tab'] });
    }
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
    clearGrab();
    observer?.disconnect();
    sidebarObserver?.disconnect();
    deferredRows.clear();
    for (const space of window.gBrowser?.tabContainer?.querySelectorAll('zen-workspace') || [])
      space.removeAttribute('data-zsf-scroll-stable');
    for (const [node, type, fn, options] of listeners) node.removeEventListener(type, fn, options);
    queuedGroups.clear();
    states.clear();
    delete window.__zsfCollapseV037;
  }
  window.__zsfCollapseV037 = { version: '0.4.2', revision: '0.6.6', start, sync, whenIdle, prepareToMoveTabs, clearLegacyFlags, destroy };
  if (document.readyState === 'complete') start();
  else bind(window, 'load', start, { once: true });
  bind(window, 'unload', destroy, { once: true });
})();
