// Zen Site Folders v0.9.0 — keep background tabs asleep while sorting.
// This layer does not replace native/Zia drop positioning or group animations.
(() => {
  'use strict';
  const KEY = '__zsfBackgroundDragV090';
  const PREF = 'zen.sitefolders.background_drag.enabled';
  if (window[KEY]) return;
  let readinessAttempts = 0;
  function boot() {
  const browser = window.gBrowser;
  const strip = browser?.tabContainer;
  const dnd = strip?.tabDragAndDrop;
  if (!browser || !strip || typeof dnd?.startTabDrag !== 'function') {
    if (++readinessAttempts <= 20) window.setTimeout(boot, 100);
    return;
  }

  let alive = true, gesture = null, dragDepth = 0, timer = null;
  const undo = [], listeners = [];
  const enabled = () => {
    try { return alive && Services.prefs.getBoolPref(PREF, true); }
    catch (_) { return alive; }
  };
  const isTab = node => !!node && (browser.isTab?.(node) || node.localName === 'tab');
  function tabAt(node) {
    const tab = node?.closest?.('tab, tabbrowser-tab, .tabbrowser-tab');
    return isTab(tab) && strip.contains(tab) ? tab : null;
  }
  const splitTab = tab => !!tab?.closest?.(
    'tab-group[split-view-group], tab-group[zen-split-view], tab-group[is-zen-split]');
  function descriptor(obj, key) {
    for (let p = obj; p; p = Object.getPrototypeOf(p)) {
      const d = Object.getOwnPropertyDescriptor(p, key);
      if (d) return d;
    }
    return null;
  }
  function replace(obj, key, next) {
    const own = Object.getOwnPropertyDescriptor(obj, key);
    if (own && !own.configurable) throw Error(key + ' is not configurable');
    Object.defineProperty(obj, key, next);
    undo.push(() => {
      const live = Object.getOwnPropertyDescriptor(obj, key);
      if (live?.get !== next.get || live?.set !== next.set || live?.value !== next.value) return;
      if (own) Object.defineProperty(obj, key, own);
      else delete obj[key];
    });
  }
  function guarded(tab) {
    return enabled() && !!gesture && tab === gesture.tab &&
      browser.selectedTab === gesture.previous && (gesture.pressed || gesture.dragging);
  }
  function wrapSelection(obj, key) {
    const d = descriptor(obj, key);
    if (!d?.get || !d?.set) return false;
    replace(obj, key, {
      configurable: true, enumerable: d.enumerable,
      get() { return d.get.call(this); },
      set(tab) { if (!guarded(tab)) return d.set.call(this, tab); }
    });
    return true;
  }
  function wrapMethod(obj, key, callback) {
    const d = descriptor(obj, key), original = obj[key];
    if (!d || typeof original !== 'function') return false;
    replace(obj, key, {
      configurable: true, enumerable: d.enumerable, writable: true,
      value: callback(original)
    });
    return true;
  }
  function listen(name, fn) {
    window.addEventListener(name, fn, true);
    listeners.push(() => window.removeEventListener(name, fn, true));
  }
  function clearTimer() {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  }
  function clear() { clearTimer(); gesture = null; }
  function releaseAfter(ms) {
    clearTimer();
    const held = gesture;
    timer = window.setTimeout(() => {
      timer = null;
      if (gesture === held) gesture = null;
    }, ms);
  }
  function onDown(event) {
    clear();
    if (!enabled() || event.button !== 0 || event.shiftKey || event.ctrlKey ||
        event.altKey || event.metaKey || !strip.contains(event.target) ||
        event.target?.closest?.(
          '.tab-close-button, .tab-icon-overlay, .tab-audio-button, ' +
          '.tab-reset-button, .tab-reset-pin-button, .tab-note-icon-overlay, ' +
          'button, toolbarbutton, input')) return;
    const tab = tabAt(event.target);
    if (!tab || tab === browser.selectedTab || splitTab(tab) ||
        tab.hasAttribute?.('zen-glance-tab')) return;
    gesture = {tab, previous: browser.selectedTab, pressed: true,
      dragging: false, x: event.clientX, y: event.clientY};
  }
  function onMove(event) {
    if (!gesture || gesture.dragging) return;
    if (!(event.buttons & 1)) { clear(); return; }
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= 5)
      gesture.dragging = true;
  }
  function onStart(event) {
    if (!gesture) return;
    if (event.composedPath?.().includes(gesture.tab) ||
        gesture.tab.contains?.(event.target)) gesture.dragging = true;
  }
  function onUp(event) {
    if (event.button !== 0 || !gesture) return;
    const held = gesture;
    held.pressed = false;
    if (!held.dragging) {
      if (held.tab.isConnected && tabAt(event.target) === held.tab &&
          browser.selectedTab === held.previous)
        browser.selectedTab = held.tab; // Real click: retain ordinary activation.
      releaseAfter(0);
    } else {
      // Protect asynchronous native/Zia landing. Never delay the actual drop.
      releaseAfter(90);
    }
  }
  function onDrop() { if (gesture?.dragging) releaseAfter(90); }
  function install() {
    if (!wrapSelection(browser, 'selectedTab'))
      throw Error('Native selectedTab accessor unavailable');
    wrapSelection(strip, 'selectedItem');
    wrapMethod(browser, 'setSelectedTab', original => function (tab, ...args) {
      if (guarded(tab)) return undefined;
      return original.call(this, tab, ...args);
    });
    const elements = descriptor(browser, 'selectedElements');
    if (elements?.get) replace(browser, 'selectedElements', {
      configurable: true, enumerable: elements.enumerable,
      get() {
        if (enabled() && dragDepth && gesture?.dragging && !gesture.tab.multiselected)
          return [gesture.tab];
        return elements.get.call(this);
      }
    });
    const tabs = descriptor(browser, 'selectedTabs');
    if (tabs?.get) replace(browser, 'selectedTabs', {
      configurable: true, enumerable: tabs.enumerable,
      get() {
        const normal = tabs.get.call(this);
        if (enabled() && dragDepth && gesture?.dragging && gesture.tab.multiselected &&
            Array.isArray(normal))
          return normal.filter(tab => tab === gesture.tab || tab.multiselected);
        return normal;
      }
    });
    wrapMethod(dnd, 'startTabDrag', original => function (event, item, ...args) {
      if (!enabled() || !gesture || gesture.tab !== item)
        return original.call(this, event, item, ...args);
      gesture.dragging = true;
      dragDepth++;
      try { return original.call(this, event, item, ...args); }
      finally { dragDepth--; }
    });
    listen('mousedown', onDown);
    listen('mousemove', onMove);
    listen('dragstart', onStart);
    listen('mouseup', onUp);
    listen('drop', onDrop);
    listen('dragend', onDrop);
    listen('deactivate', clear);
    listen('keydown', event => { if (event.key === 'Escape') clear(); });
    listen('unload', destroy);
  }
  function destroy() {
    alive = false;
    clear();
    for (const fn of listeners.splice(0).reverse()) { try { fn(); } catch (_) {} }
    for (const fn of undo.splice(0).reverse()) { try { fn(); } catch (_) {} }
    if (window[KEY] === api) delete window[KEY];
  }
  const api = {
    version: '0.9.0', destroy,
    debug: () => ({enabled: enabled(), holding: !!gesture,
      dragging: !!gesture?.dragging, dragDepth})
  };
  window[KEY] = api;
  try { install(); }
  catch (error) {
    console.warn('[ZenSiteFoldersBackgroundDrag] Native hooks unavailable:', error);
    destroy(); // Fail closed; leave Zen's original selection behavior intact.
  }
  }
  // Sine may evaluate chrome scripts before Zen has initialized native DnD.
  if (typeof document === 'undefined' || document.readyState === 'complete') boot();
  else window.addEventListener('load', boot, {once: true});
})();