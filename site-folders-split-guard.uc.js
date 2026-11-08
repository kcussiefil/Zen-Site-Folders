// ==UserScript==
// @name         Zen Site Folders — split-view group admission guard
// @version      0.8.2
// @description  Keep Zen split views outside ordinary groups during native/Zia drags.
// @include      chrome://browser/content/browser.xhtml
// ==/UserScript==
(() => {
  'use strict';
  window.__zsfSplitGuardV1?.destroy?.();
  const SPLIT = 'tab-group[split-view-group]';
  const GROUP = 'tab-group:not([split-view-group]), zen-folder';
  let grabbed = null, active = false, blocked = 0, cleanup = 0, dead = false;
  const undo = [], listeners = [], patched = new WeakMap();
  const bind = (host, name, fn, opts = true) => {
    host?.addEventListener?.(name, fn, opts);
    listeners.push([host, name, fn, opts]);
  };
  const splitOf = node => node?.matches?.(SPLIT) ? node :
    node?.group?.matches?.(SPLIT) ? node.group : node?.closest?.(SPLIT) || null;
  const isSplitItem = node => !!node && (node.matches?.(SPLIT) ||
    (node.localName === 'tab' && node.group?.matches?.(SPLIT)));
  // Movement between the two panes of the same split is not a folder drop.
  const insideOrdinaryGroup = parent =>
    !!parent?.closest?.(GROUP) && !parent?.closest?.(SPLIT);
  const deny = (node, parent) => {
    if (!active || !isSplitItem(node) || !insideOrdinaryGroup(parent)) return false;
    blocked++;
    return true;
  };
  function patch(host, key, check, fallback) {
    if (!host || typeof host[key] !== 'function') return;
    let keys = patched.get(host);
    if (!keys) { keys = new Set(); patched.set(host, keys); }
    if (keys.has(key)) return;
    const descriptor = Object.getOwnPropertyDescriptor(host, key);
    if (descriptor && !descriptor.configurable) {
      console.warn('[ZSF Split Guard] Unavailable nonconfigurable hook:', key);
      return;
    }
    const original = host[key];
    const wrapper = function (...args) {
      if (check.call(this, ...args)) return fallback(args);
      return original.apply(this, args);
    };
    try {
      Object.defineProperty(host, key, { configurable: true, writable: true, value: wrapper });
      keys.add(key);
      undo.push(() => {
        keys.delete(key);
        if (host[key] !== wrapper) return;
        if (descriptor) Object.defineProperty(host, key, descriptor);
        else delete host[key];
      });
    } catch (error) { console.warn('[ZSF Split Guard] Hook failed:', key, error); }
  }
  function protectGroup(group) {
    const box = group.groupContainer || group.querySelector?.(':scope > .tab-group-container');
    for (const host of [group, box]) {
      patch(host, 'appendChild', function (node) { return deny(node, this); }, a => a[0]);
      patch(host, 'insertBefore', function (node) { return deny(node, this); }, a => a[0]);
      patch(host, 'replaceChild', function (node) { return deny(node, this); }, a => a[1]);
      patch(host, 'append', function (...items) { return items.some(item => deny(item, this)); }, () => undefined);
      patch(host, 'prepend', function (...items) { return items.some(item => deny(item, this)); }, () => undefined);
    }
    patch(group, 'addTabs', function (tabs) {
      return Array.from(tabs || []).some(tab => deny(tab, this));
    }, () => undefined);
    for (const row of [group.labelContainerElement, group.groupStartElement, ...Array.from(box?.children || [])]) {
      for (const key of ['before', 'after', 'replaceWith']) {
        patch(row, key, function (...items) {
          return items.some(item => deny(item, this.parentNode));
        }, () => undefined);
      }
    }
  }
  function protectBrowser() {
    const browser = window.gBrowser;
    patch(browser, 'moveTabBefore', function (item, before) {
      return deny(item, before?.parentNode);
    }, a => a[0]);
    patch(browser, 'moveTabAfter', function (item, after) {
      return deny(item, after?.parentNode);
    }, a => a[0]);
    patch(browser, 'moveTabToExistingGroup', function (item, group) {
      return deny(item, group);
    }, a => a[0]);
  }
  function refresh() {
    if (!active) return;
    protectBrowser();
    for (const group of document.querySelectorAll?.(GROUP) || []) protectGroup(group);
  }
  function arm(node) {
    if (dead || !splitOf(node)) return false;
    if (cleanup) { clearTimeout(cleanup); cleanup = 0; }
    active = true;
    refresh();
    return true;
  }
  function disarm() {
    if (cleanup) { clearTimeout(cleanup); cleanup = 0; }
    active = false;
    for (const restore of undo.splice(0).reverse()) {
      try { restore(); } catch (error) { console.warn('[ZSF Split Guard] Restore failed:', error); }
    }
    document.documentElement?.removeAttribute?.('data-zsf-split-drop-blocked');
    grabbed = null;
  }
  function deferDisarm() {
    if (!active || cleanup) return;
    // Zia's split placement may be queued after the drop handler.
    cleanup = setTimeout(disarm, 0);
  }
  function start() {
    if (dead) return;
    const strip = document.getElementById?.('tabbrowser-tabs');
    if (!strip) return;
    bind(strip, 'mousedown', event => { grabbed = event.button === 0 ? splitOf(event.target) : null; });
    bind(window, 'dragstart', event => {
      const source = splitOf(event.target) || grabbed;
      grabbed = null;
      if (source) arm(source);
    });
    bind(window, 'dragover', event => {
      if (!active) return;
      refresh();
      const targetGroup = event.target?.closest?.(GROUP);
      const forbidden = !!targetGroup && insideOrdinaryGroup(targetGroup);
      document.documentElement?.toggleAttribute?.('data-zsf-split-drop-blocked', forbidden);
      if (forbidden && event.dataTransfer) {
        try { event.dataTransfer.dropEffect = 'none'; } catch (_) {}
      }
    });
    bind(window, 'drop', deferDisarm);
    bind(window, 'dragend', deferDisarm);
    bind(window, 'mouseup', () => { if (!active) grabbed = null; });
    bind(window, 'keydown', event => { if (event.key === 'Escape') disarm(); });
    bind(window, 'deactivate', disarm);
    bind(window, 'unload', destroy, { once: true });
  }
  function destroy() {
    dead = true;
    disarm();
    for (const [host, name, fn, opts] of listeners)
      host?.removeEventListener?.(name, fn, opts);
    listeners.length = 0;
    delete window.__zsfSplitGuardV1;
  }
  window.__zsfSplitGuardV1 = { arm, disarm, refresh, destroy,
    status: () => ({ active, blocked }) };
  if (document.readyState === 'complete') start();
  else bind(window, 'load', start, { once: true });
})();
