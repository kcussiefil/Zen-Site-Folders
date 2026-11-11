// Zen Site Folders v0.9.2 — keep background tabs asleep while sorting.
// This layer does not replace native/Zia drop positioning or group animations.
(() => {
  'use strict';
  const KEY = '__zsfBackgroundDragV090';
  const TAB_DROP_TYPE = 'application/x-moz-tabbrowser-tab';
  const PREF = 'zen.sitefolders.background_drag.enabled';
  // Sine can hot-reload a corrected version in the same Zen window.
  // Never leave the v0.9.0 wrappers active and silently skip the fix.
  if (window[KEY]?.version === '0.9.2') return;
  window[KEY]?.destroy?.();
  let readinessAttempts = 0;
  function boot() {
  const browser = window.gBrowser;
  const strip = browser?.tabContainer;
  const dnd = strip?.tabDragAndDrop;
  if (!browser || !strip || typeof dnd?.startTabDrag !== 'function') {
    if (++readinessAttempts <= 20) window.setTimeout(boot, 100);
    return;
  }

  let alive = true, gesture = null, dragDepth = 0, clickTimer = null;
  const landing = new Map();
  const undo = [], listeners = [];
  let browserGuard = null, stripGuard = null, dragGuard = null;
  const trace = [];
  function record(kind, detail = '') {
    try { if (!Services.prefs.getBoolPref('zen.sitefolders.background_drag.debug', false)) return; }
    catch (_) { return; }
    trace.push({kind, detail, time: Date.now()});
    if (trace.length > 80) trace.shift();
  }
  const enabled = () => {
    try { return alive && Services.prefs.getBoolPref(PREF, true); }
    catch (_) { return alive; }
  };
  const isTab = node => !!node && (browser.isTab?.(node) || node.localName === 'tab');
  function tabAt(node) {
    const tab = node?.closest?.('tab, tabbrowser-tab, .tabbrowser-tab');
    return isTab(tab) && strip.contains(tab) ? tab : null;
  }
  // XUL/Sine/Zia overlays can retarget a trusted mouse event to an ancestor
  // outside the tab strip. The *composed path*, not event.target, owns the tab.
  function sourceOf(event) {
    const direct = tabAt(event?.target);
    if (direct) return direct;
    const path = event?.composedPath?.() || [];
    return path.find(node => {
      try { return isTab(node) && strip.contains(node); }
      catch (_) { return false; }
    }) || null;
  }
  const CONTROLS = '.tab-close-button, .tab-icon-overlay, .tab-audio-button, ' +
    '.tab-reset-button, .tab-reset-pin-button, .tab-note-icon-overlay, ' +
    'button, toolbarbutton, input';
  function onControl(event) {
    return (event.composedPath?.() || [event.target]).some(node =>
      node?.matches?.(CONTROLS));
  }
  const splitTab = tab => !!tab?.splitview || !!tab?.closest?.(
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
    return enabled() && !!tab && !splitTab(tab) &&
      (landing.has(tab) || (tab === gesture?.tab && (gesture.pressed || gesture.dragging)));
  }
  function wrapSelection(obj, key) {
    const d = descriptor(obj, key);
    if (!d?.get || !d?.set) return false;
    const next = {
      configurable: true, enumerable: d.enumerable,
      get() { return d.get.call(this); },
      set(tab) {
        if (guarded(tab)) { record('blocked-selection', key); return; }
        return d.set.call(this, tab);
      }
    };
    replace(obj, key, next);
    return next;
  }
  function wrapMethod(obj, key, callback) {
    const d = descriptor(obj, key), original = obj[key];
    if (!d || typeof original !== 'function') return false;
    const next = {
      configurable: true, enumerable: d.enumerable, writable: true,
      value: callback(original)
    };
    replace(obj, key, next);
    return next;
  }
  function listen(name, fn) {
    window.addEventListener(name, fn, true);
    listeners.push(() => window.removeEventListener(name, fn, true));
  }
  function clearPress() {
    if (clickTimer !== null) window.clearTimeout(clickTimer);
    clickTimer = null;
    gesture = null;
  }
  function clearLanding(tab) {
    if (!landing.has(tab)) return;
    window.clearTimeout(landing.get(tab));
    landing.delete(tab);
  }
  function settle(tab) {
    clearLanding(tab);
    // Zia can finish the previous placement after the next press has begun.
    landing.set(tab, window.setTimeout(() => landing.delete(tab), 90));
  }
  // If Zen or another Sine module replaces an accessor after our first
  // drag, refresh ownership on the next real press. Never alter drag ordering.
  function sameHook(obj, key, expected) {
    if (!expected) return false;
    const live = Object.getOwnPropertyDescriptor(obj, key);
    return live?.get === expected.get && live?.set === expected.set &&
      live?.value === expected.value;
  }
  function nativeDragWrapper(original) {
    return function (event, item, ...args) {
      if (!enabled() || !isTab(item) || splitTab(item) ||
          item.hasAttribute?.('zen-glance-tab'))
        return original.call(this, event, item, ...args);
      // A valid native drag has an authoritative source even if the
      // preceding mousedown was retargeted or another listener consumed it.
      if (gesture?.tab !== item) {
        const previous = browser.selectedTab;
        if (previous !== item) {
          gesture = {tab: item, previous, pressed: false, dragging: true,
            x: event?.clientX ?? 0, y: event?.clientY ?? 0};
          record('recovered-native-drag');
        } else {
          record('native-source-already-selected');
        }
      }
      if (gesture?.tab !== item) return original.call(this, event, item, ...args);
      gesture.dragging = true;
      dragDepth++;
      try { return original.call(this, event, item, ...args); }
      finally { dragDepth--; }
    };
  }
  function refreshHooks() {
    if (!alive) return;
    try {
      if (!sameHook(browser, 'selectedTab', browserGuard)) {
        browserGuard = wrapSelection(browser, 'selectedTab');
        record('reinstalled-browser-selection');
      }
      if (stripGuard && !sameHook(strip, 'selectedItem', stripGuard)) {
        stripGuard = wrapSelection(strip, 'selectedItem');
        record('reinstalled-strip-selection');
      }
      if (!sameHook(dnd, 'startTabDrag', dragGuard)) {
        dragGuard = wrapMethod(dnd, 'startTabDrag', nativeDragWrapper);
        record('reinstalled-native-drag');
      }
    } catch (error) {
      console.warn('[ZenSiteFoldersBackgroundDrag] Unable to refresh native guards:', error);
    }
  }
  function onDown(event) {
    if (!enabled() || event.button !== 0 || event.shiftKey || event.ctrlKey ||
        event.altKey || event.metaKey) return;
    const tab = sourceOf(event);
    // A separate retargeted mousedown can follow a pointerdown in Gecko.
    // It must NOT erase the background tab armed by pointerdown.
    if (!tab) return;
    if (onControl(event) || splitTab(tab) ||
        tab.hasAttribute?.('zen-glance-tab')) {
      clearPress();
      return;
    }
    // pointerdown followed by mousedown is one press only until it starts
    // dragging. A fresh press after drop (which may omit mouseup) is new.
    if (gesture?.pressed && gesture.tab === tab && !gesture.dragging) return;
    clearPress();
    if (tab === browser.selectedTab) return;
    refreshHooks();
    gesture = {tab, previous: browser.selectedTab, pressed: true,
      dragging: false, x: event.clientX, y: event.clientY};
    record('armed-press', event.type);
  }
  function onMove(event) {
    if (!gesture?.pressed || gesture.dragging) return;
    // Gecko can report buttons=0 on a transition into native DnD even
    // while the physical button is still held. Do not drop the guard here:
    // only mouseup, Escape, or an owned finalization can end this press.
    if (!(event.buttons & 1)) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= 5)
      gesture.dragging = true;
  }
  function onStart(event) {
    const source = sourceOf(event);
    if (!source) return;
    if (!gesture && enabled() && source !== browser.selectedTab &&
        !splitTab(source) && !source.hasAttribute?.('zen-glance-tab')) {
      gesture = {tab: source, previous: browser.selectedTab, pressed: true,
        dragging: true, x: event.clientX, y: event.clientY};
      record('recovered-dragstart');
    }
    if (gesture?.tab === source) gesture.dragging = true;
  }
  function onUp(event) {
    if (event.button !== 0 || !gesture?.pressed) return;
    const held = gesture;
    held.pressed = false;
    if (held.dragging) {
      settle(held.tab);
      clearPress();
    } else {
      // A release without an actual click can follow a cancelled native drag.
      // Never wake the tab until a real click arrives.
      clickTimer = window.setTimeout(clearPress, 90);
    }
  }
  function onClick(event) {
    if (event.button !== 0 || !gesture || gesture.pressed || gesture.dragging) return;
    const {tab, previous} = gesture;
    clearPress();
    if (enabled() && tab.isConnected && sourceOf(event) === tab &&
        browser.selectedTab === previous) {
      clearLanding(tab);
      browser.selectedTab = tab;
    }
  }
  function onFinish(event) {
    if (!gesture?.dragging && !landing.size) return;
    const source = event.dataTransfer?.mozGetDataAt?.(TAB_DROP_TYPE, 0) ||
      (event.type === 'dragend' ? tabAt(event.target) : null);
    if (!source) return;
    // dragend may signal native cancellation before the physical button is
    // released. Keep the in-progress source guarded until mouseup, rather
    // than permitting Zen to select/wake the tab while the pointer is held.
    if (gesture?.dragging && gesture.tab === source) {
      if (!gesture.pressed) clearPress();
    } else if (!landing.has(source)) return;
    if (event.type === 'drop' && !strip.contains(event.target)) {
      clearLanding(source); // A page drop can intentionally activate a new split.
      if (gesture?.tab === source) clearPress();
      return;
    }
    settle(source);
  }
  function install() {
    browserGuard = wrapSelection(browser, 'selectedTab');
    if (!browserGuard) throw Error('Native selectedTab accessor unavailable');
    stripGuard = wrapSelection(strip, 'selectedItem');
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
    // Zen normally captures a native drag image. Asking PageThumbs for an
    // unloaded source can wake it during startTabDrag; omit only that capture.
    let thumbs = window.PageThumbs || null;
    if (!thumbs) {
      try { thumbs = ChromeUtils.importESModule(
        'resource://gre/modules/PageThumbs.sys.mjs').PageThumbs; }
      catch (_) {}
    }
    if (thumbs && typeof thumbs.captureToCanvas === 'function') {
      wrapMethod(thumbs, 'captureToCanvas', original => function (sourceBrowser, ...args) {
        const tab = gesture?.tab;
        const asleep = tab?.hasAttribute?.('pending') || tab?.hasAttribute?.('discarded') ||
          (!tab?.linkedPanel && 'linkedPanel' in (tab || {}));
        if (enabled() && dragDepth && asleep &&
            (tab?.linkedBrowser === sourceBrowser ||
              browser.getTabForBrowser?.(sourceBrowser) === tab))
          return Promise.resolve();
        return original.call(this, sourceBrowser, ...args);
      });
    }
    dragGuard = wrapMethod(dnd, 'startTabDrag', nativeDragWrapper);
    if (!dragGuard) throw Error('Native startTabDrag unavailable');
    listen('pointerdown', onDown);
    listen('mousedown', onDown);
    listen('mousemove', onMove);
    listen('dragstart', onStart);
    listen('mouseup', onUp);
    listen('click', onClick);
    listen('drop', onFinish);
    listen('dragend', onFinish);
    // A native drag may transiently deactivate chrome without a real mouseup.
    // Keep the guard until the drag owns a matching drop/dragend or mouseup.
    listen('deactivate', () => { if (!gesture?.dragging) clearPress(); });
    // Explicit keyboard navigation is a new user action; do not let an
    // aborted OS drag leave a stale guard on that tab indefinitely.
    listen('keydown', event => {
      if (event.key === 'Escape' || !gesture?.pressed) clearPress();
    });
    listen('unload', destroy);
  }
  function destroy() {
    alive = false;
    clearPress();
    for (const tab of landing.keys()) clearLanding(tab);
    for (const fn of listeners.splice(0).reverse()) { try { fn(); } catch (_) {} }
    for (const fn of undo.splice(0).reverse()) { try { fn(); } catch (_) {} }
    if (window[KEY] === api) delete window[KEY];
  }
  const api = {
    version: '0.9.2', destroy,
    debug: () => ({enabled: enabled(), holding: !!gesture,
      dragging: !!gesture?.dragging, dragDepth,
      guards: {
        browser: sameHook(browser, 'selectedTab', browserGuard),
        strip: !stripGuard || sameHook(strip, 'selectedItem', stripGuard),
        drag: sameHook(dnd, 'startTabDrag', dragGuard)
      }, trace: trace.slice()})
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