// ==UserScript==
// @name         Zen Site Folders — fluid native/fallback collapse
// @version      0.3.4
// @description  Prefer Zia's native spring, otherwise animate actual group height.
// @include      chrome://browser/content/browser.xhtml
// ==/UserScript==
(() => {
  'use strict';
  if (window.__zsfCollapseV034) return;

  const SELECTOR = 'tab-group[data-zsf-site]:not([split-view-group])';
  const SETTLED = 'data-zsf-collapse-settled';
  const ANIMATING = 'data-zsf-animating';
  const SPRING_MS = 420;
  const states = new Map();
  let observer = null;
  let started = false;
  let destroyed = false;

  const isOurs = group => !!group?.isConnected && group.matches?.(SELECTOR) &&
    !group.isZenFolder && !group.pinned;
  const folded = group => group?.hasAttribute?.('collapsed') === true;
  const containerOf = group =>
    group?.groupContainer || group?.querySelector?.(':scope > .tab-group-container');

  function selectedMember(group) {
    return [...(group?.tabs || group?.querySelectorAll?.('tab') || [])]
      .find(tab => tab?.isConnected && tab.group === group &&
        (tab.selected || tab.hasAttribute('selected'))) || null;
  }

  function heightOf(element) {
    try {
      const value = element?.getBoundingClientRect?.().height;
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    } catch (_) { return 0; }
  }

  function visibleSelectedHeight(group) {
    const tab = selectedMember(group);
    if (!tab) return 0;
    const box = containerOf(group);
    let spacing = 0;
    try {
      const containerStyle = window.getComputedStyle?.(box);
      const tabStyle = window.getComputedStyle?.(tab);
      // CSS box height excludes the tab's outside margins. The v0.3.3
      // fallback animated to a shorter target, then snapped to the real
      // natural selected-row height when the animation finished.
      spacing = (parseFloat(containerStyle?.paddingTop) || 0) +
        (parseFloat(containerStyle?.paddingBottom) || 0) +
        (parseFloat(tabStyle?.marginTop) || 0) +
        (parseFloat(tabStyle?.marginBottom) || 0);
    } catch (_) {}
    return heightOf(tab) + spacing;
  }

  function finish(group, token) {
    if (destroyed || !isOurs(group)) return;
    const current = states.get(group);
    if (!current || current.token !== token) return;
    states.delete(group);
    if (folded(group)) group.setAttribute(SETTLED, 'true');
    else group.removeAttribute(SETTLED);
    group.removeAttribute(ANIMATING);
  }

  function stopOwnAnimation(group) {
    const state = states.get(group);
    if (state?.fallback) {
      try { state.fallback.cancel(); } catch (_) {}
    }
    states.delete(group);
  }

  function prepare(group) {
    if (!isOurs(group)) return;
    const box = containerOf(group);
    if (!box) return;
    const from = heightOf(box);
    const wasFolded = folded(group);
    stopOwnAnimation(group);
    const token = {};
    states.set(group, { token, from, wasFolded, toggled: false, fallback: null });
    // Set before the browser toggles collapsed so native Zia can measure and
    // animate the actual children, not an already display:none container.
    group.setAttribute(ANIMATING, 'true');
    group.removeAttribute(SETTLED);
    requestAnimationFrame(() => {
      const current = states.get(group);
      if (current?.token === token && !current.toggled &&
          wasFolded === folded(group)) finish(group, token);
    });
  }

  function nativeGeometryAnimations(group, box) {
    const elements = [box, group.groupStartElement,
      box?.querySelector?.('.zen-tab-group-start')].filter(Boolean);
    const found = new Set();
    for (const node of elements) {
      let animations = [];
      try { animations = node.getAnimations?.({ subtree: true }) || []; }
      catch (_) {}
      for (const animation of animations) {
        if (!animation || found.has(animation) || animation.playState !== 'running') continue;
        let frames = [];
        try { frames = animation.effect?.getKeyframes?.() || []; } catch (_) {}
        if (frames.some(frame => ['height', 'minHeight', 'marginTop', 'marginBottom']
          .some(key => Object.prototype.hasOwnProperty.call(frame, key)))) {
          found.add(animation);
        }
      }
    }
    return [...found];
  }

  function settleAfterNative(group, token, animations) {
    Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      // Zia may finish its animation on the same frame it applies inline
      // cleanup; don't override the final state until that frame is painted.
      requestAnimationFrame(() => finish(group, token));
    });
  }

  function fallbackHeightAnimation(group, token, from) {
    const box = containerOf(group);
    if (!box || !isOurs(group)) { finish(group, token); return; }
    const end = folded(group) ? visibleSelectedHeight(group) :
      Math.max(box.scrollHeight || 0, heightOf(box));
    if (!Number.isFinite(end) || !Number.isFinite(from) ||
        Math.abs(from - end) < 0.5 || typeof box.animate !== 'function') {
      finish(group, token);
      return;
    }

    // Match Zia's 420ms spring rather than waiting 470ms and snapping.
    // Animate the group container height so every row below moves smoothly.
    const beyond = end + Math.sign(end - from) * Math.min(2, Math.abs(end - from) / 4);
    const frames = [
      { height: from + 'px', offset: 0 },
      { height: beyond + 'px', offset: 0.72 },
      { height: end + 'px', offset: 1 }
    ];
    let animation;
    try {
      animation = box.animate(frames, {
        duration: SPRING_MS, easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        fill: 'both'
      });
    } catch (error) {
      console.warn('[ZenSiteFoldersCollapse] Height animation unavailable:', error);
      finish(group, token);
      return;
    }
    const current = states.get(group);
    if (!current || current.token !== token) {
      try { animation.cancel(); } catch (_) {}
      return;
    }
    current.fallback = animation;
    animation.finished.then(() => {
      if (states.get(group)?.token !== token) return;
      finish(group, token);
      try { animation.cancel(); } catch (_) {}
    }, () => { /* Reversed/cancelled by the next interaction. */ });
  }

  function onToggle(event) {
    const group = event.target;
    if (!isOurs(group)) return;
    let state = states.get(group);
    if (!state) {
      prepare(group);
      state = states.get(group);
      if (!state) return;
      // Programmatic toggle: a closed group has no visible height. Read the
      // full scrollHeight after applying the temporary animating state.
      if (event.type === 'TabGroupCollapse')
        state.from = Math.max(state.from, containerOf(group)?.scrollHeight || 0);
    }
    const token = state.token;
    state.toggled = true;
    const from = state.from;
    requestAnimationFrame(() => {
      if (states.get(group)?.token !== token || !isOurs(group)) return;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
        finish(group, token);
        return;
      }
      const box = containerOf(group);
      if (!box) { finish(group, token); return; }
      const native = nativeGeometryAnimations(group, box);
      if (native.length) {
        settleAfterNative(group, token, native);
      } else {
        fallbackHeightAnimation(group, token, from);
      }
    });
  }

  function onLabelClick(event) {
    if (event.button !== 0) return;
    const target = event.target;
    const label = target?.closest?.('.tab-group-label-container');
    const group = label?.parentElement;
    if (!isOurs(group)) return;
    // No click interception: this is a read-only pre-measurement.
    if (target.closest?.('toolbarbutton, button, .tab-close-button, .tab-reset-button')) return;
    prepare(group);
  }

  function syncInitial(group) {
    if (!isOurs(group)) return;
    stopOwnAnimation(group);
    group.removeAttribute(ANIMATING);
    if (folded(group)) group.setAttribute(SETTLED, 'true');
    else group.removeAttribute(SETTLED);
  }

  function start() {
    if (destroyed || started) return;
    const tabs = window.gBrowser?.tabContainer;
    if (!tabs) return;
    started = true;
    for (const group of tabs.querySelectorAll?.(SELECTOR) || []) syncInitial(group);
    // Capture before Zen toggles a group, without stopping the browser event.
    window.addEventListener('click', onLabelClick, true);
    window.addEventListener('TabGroupCollapse', onToggle, true);
    window.addEventListener('TabGroupExpand', onToggle, true);
    observer = new MutationObserver(changes => {
      for (const change of changes) {
        if (change.type !== 'childList') continue;
        for (const node of change.addedNodes || []) {
          if (node?.nodeType !== 1) continue;
          if (isOurs(node)) syncInitial(node);
          for (const group of node.querySelectorAll?.(SELECTOR) || [])
            syncInitial(group);
        }
      }
    });
    // No collapsed-attribute observer: that would compete with the native
    // TabGroupCollapse/Expand event and reset an animation mid-flight.
    observer.observe(tabs, { subtree: true, childList: true });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    observer?.disconnect();
    window.removeEventListener('click', onLabelClick, true);
    window.removeEventListener('TabGroupCollapse', onToggle, true);
    window.removeEventListener('TabGroupExpand', onToggle, true);
    for (const group of [...states.keys()]) stopOwnAnimation(group);
    for (const group of window.gBrowser?.tabContainer?.querySelectorAll?.(SELECTOR) || []) {
      group.removeAttribute(ANIMATING);
      group.removeAttribute(SETTLED);
    }
    if (window.__zsfCollapseV034 === api) delete window.__zsfCollapseV034;
  }

  const api = { start, destroy, prepare, onToggle, nativeGeometryAnimations,
    version: '0.3.4' };
  window.__zsfCollapseV034 = api;
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
  window.addEventListener('unload', destroy, { once: true });
})();
