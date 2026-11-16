// ==UserScript==
// @name         Zen Site Folders — 右鍵建立群組
// @version      1.0.9
// @description  Right-click-only native grouping for multiselected unpinned Zen tabs.
// @include      chrome://browser/content/browser.xhtml
// ==/UserScript==
(() => {
  'use strict';
  const KEY = '__zsfManualGroupsV099';
  if (window[KEY]?.destroy) window[KEY].destroy();
  const TAG = '[ZenSiteFoldersManual]';
  const STORE = 'zsf-manual-groups-v1';
  const FOLDER_ICON = 'chrome://browser/skin/zen-icons/folder.svg';
  const listeners = [];
  let destroyed = false, started = false;
  let menuItem = null, restoreTimer = null;
  let sessionStore = null;
  try {
    sessionStore = window.SessionStore ||
      ChromeUtils.importESModule('resource:///modules/sessionstore/SessionStore.sys.mjs').SessionStore;
  } catch (error) { console.warn(TAG, 'SessionStore unavailable', error); }

  function bind(node, name, fn, capture = false) {
    if (!node?.addEventListener) return;
    node.addEventListener(name, fn, capture);
    listeners.push([node, name, fn, capture]);
  }
  function registry() {
    try {
      const raw = sessionStore?.getCustomWindowValue?.(window, STORE);
      const data = raw ? JSON.parse(raw) : {};
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (_) { return {}; }
  }
  function saveRegistry(map) {
    if (!sessionStore?.setCustomWindowValue || !sessionStore?.getCustomWindowValue) return false;
    try {
      const value = JSON.stringify(map);
      sessionStore.setCustomWindowValue(window, STORE, value);
      return sessionStore.getCustomWindowValue(window, STORE) === value;
    } catch (error) {
      console.warn(TAG, 'Could not persist manual groups', error);
      return false;
    }
  }
  function workspace(tab) {
    return tab?.closest?.('zen-workspace') || null;
  }
  function eligible(tab) {
    return !!tab?.isConnected &&
      (tab.localName === 'tab' || tab.classList?.contains?.('tabbrowser-tab')) &&
      !tab.pinned && !tab.group && !tab.splitview &&
      !tab.hasAttribute?.('zen-essential') &&
      !tab.hasAttribute?.('zen-empty-tab') &&
      !tab.hasAttribute?.('zen-glance-tab') &&
      !tab.hasAttribute?.('cloned') && !tab.closing &&
      !!workspace(tab) && tab.parentElement === workspace(tab).tabsContainer;
  }
  function validTabs(input) {
    const tabs = [...new Set(input || [])];
    if (tabs.length < 2 || tabs.some(tab => !eligible(tab))) return null;
    const ws = workspace(tabs[0]);
    if (!ws || tabs.some(tab => workspace(tab) !== ws)) return null;
    if (window.gZenWorkspaces?.activeWorkspaceElement &&
        ws !== window.gZenWorkspaces.activeWorkspaceElement) return null;
    const sequence = [...(window.gBrowser?.tabs || [])];
    if (!tabs.every(tab => sequence.includes(tab))) return null;
    return tabs.sort((a, b) => sequence.indexOf(a) - sequence.indexOf(b));
  }
  function tabUrl(tab) {
    const raw = tab?.linkedBrowser?.currentURI?.spec ||
      tab?.getAttribute?.('linkedpanel-url') || tab?.getAttribute?.('url');
    return typeof raw === 'string' ? raw : '';
  }
  function site(tab) {
    try {
      const url = new URL(tabUrl(tab));
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      let host = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
      if (host === 'mail.google.com') return 'gmail.com';
      if (host === 'youtu.be') return 'youtube.com';
      if (host === 'twitter.com') return 'x.com';
      try { host = Services.eTLD.getBaseDomainFromHost(host) || host; }
      catch (_) {}
      return host;
    } catch (_) { return ''; }
  }
  function nameForSite(domain) {
    const names = {
      'youtube.com':'YouTube', 'reddit.com':'Reddit',
      'bilibili.com':'Bilibili', 'github.com':'GitHub',
      'google.com':'Google', 'gmail.com':'Gmail',
      'x.com':'X', 'facebook.com':'Facebook'
    };
    if (names[domain]) return names[domain];
    const name = domain.split('.')[0] || domain;
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  function nativeIcon(tab) {
    const browser = window.gBrowser;
    const value = browser?.getIcon?.(tab) ||
      tab?.querySelector?.('.tab-icon-image')?.getAttribute?.('src');
    return value || (tabUrl(tab).startsWith('http') ? 'page-icon:' + tabUrl(tab) : FOLDER_ICON);
  }
  function details(tabs) {
    const sites = tabs.map(site);
    const same = sites[0] && sites.every(value => value === sites[0]);
    return same ? {
      title: nameForSite(sites[0]), icon: nativeIcon(tabs[0]), kind: 'site'
    } : {
      title: '新群組', icon: FOLDER_ICON, kind: 'mixed'
    };
  }
  function decorate(group, info) {
    if (destroyed || !group?.isConnected || group.hasAttribute?.('data-zsf-site') ||
        group.isZenFolder || !group.matches?.('tab-group:not([split-view-group])')) return;
    group.setAttribute('data-zsf-manual', 'true');
    const label = group.querySelector('.tab-group-label-container');
    if (!label) return;
    let icon = label.querySelector(':scope > .zsf-favicon');
    if (!icon) {
      icon = document.createXULElement('image');
      icon.classList.add('zsf-favicon');
      icon.setAttribute('aria-hidden', 'true');
      label.insertBefore(icon, label.querySelector('.tab-group-label') || label.firstChild);
    }
    if (!group.hasAttribute('data-zsf-custom-icon')) {
      icon.hidden = false;
      const src = info?.icon || FOLDER_ICON;
      if (icon.getAttribute('src') !== src) icon.setAttribute('src', src);
    }
    window.__zsfMenuV037?.restoreDecorations?.();
  }
  function restore() {
    if (destroyed) return;
    const saved = registry();
    let cleaned = false;
    for (const group of document.querySelectorAll('tab-group:not([split-view-group])')) {
      const info = saved[group.id];
      if (!info || group.hasAttribute('data-zsf-site')) continue;
      decorate(group, info);
      // Migrate v1.0.0 colors to the same neutral presentation as site groups.
      // Remove both stale runtime markers and persisted color choices so they
      // cannot reappear after restart, without touching names/icons/tabs.
      group.removeAttribute('data-zsf-color-custom');
      try { if (group.color !== 'gray') group.color = 'gray'; }
      catch (_) { /* CSS below also forces the neutral template. */ }
      if (Object.prototype.hasOwnProperty.call(info, 'color')) {
        delete info.color;
        cleaned = true;
      }
    }
    if (cleaned) saveRegistry(saved);
  }
  function scheduleRestore() {
    if (restoreTimer != null) clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => { restoreTimer = null; restore(); }, 120);
  }
  function createFromTabs(input) {
    const tabs = validTabs(input);
    // The multiselection is grouped in the current native tab order.
    const before = tabs?.[0];
    const browser = window.gBrowser;
    if (!tabs || typeof browser?.addTabGroup !== 'function' ||
        !sessionStore?.setCustomWindowValue) return null;
    const info = details(tabs);
    let group;
    try {
      group = browser.addTabGroup(tabs, {
        label: info.title,
        color: 'gray',
        insertBefore: before,
        showCreateUI: false
      });
      if (!group?.isConnected || group.isZenFolder ||
          tabs.some(tab => tab.group !== group || tab.pinned))
        throw new Error('Native group creation was incomplete');
      if (!group.id) throw new Error('Native group has no stable ID');
      const map = registry();
      map[group.id] = {kind: info.kind, icon: info.icon};
      if (!saveRegistry(map))
        console.warn(TAG, 'Group exists but its custom icon may not restore');
      decorate(group, info);
      scheduleRestore();
      return group;
    } catch (error) {
      console.warn(TAG, 'Manual group creation incomplete; original tabs retained', error);
      return null;
    }
  }

  function selectedForMenu() {
    const context = window.TabContextMenu?.contextTab;
    if (!context?.multiselected) return null;
    const selected = window.gBrowser?.selectedTabs || [];
    return validTabs(selected);
  }
  function installMenu() {
    const popup = document.getElementById('tabContextMenu');
    if (!popup || menuItem?.isConnected) return !!menuItem?.isConnected;
    menuItem = document.createXULElement('menuitem');
    menuItem.id = 'zsf-manual-create-group';
    menuItem.setAttribute('label', '建立群組');
    menuItem.setAttribute('hidden', 'true');
    // Keep this and HDR Guard's selected-color action in one *native*
    // separator segment. Calmer Context Menu can reorder only within that
    // segment, even when its preview displays items in another CSS order.
    // Insert BEFORE Change Icon: Zen's ":has(+ edit-title)" and
    // "edit-icon + menuseparator" selectors remain undisturbed.
    const anchor = [
      'context_zen-edit-tab-icon',
      'context_bookmarkTab',
      'context_bookmarkSelectedTabs',
      'context_duplicateTab',
    ].map(id => document.getElementById(id))
      .find(node => node?.parentElement === popup);
    popup.insertBefore(menuItem, anchor || null);
    bind(popup, 'popupshowing', event => {
      if (event.target !== popup) return;
      menuItem.hidden = !selectedForMenu();
    });
    bind(menuItem, 'command', () => {
      const tabs = selectedForMenu();
      if (tabs) createFromTabs(tabs);
    });
    return true;
  }
  function start() {
    if (destroyed || started || !window.gBrowser?.tabContainer) return false;
    started = true;
    // Deliberately DO NOT register dragstart, dragover, drop or dragend.
    // Zen/Zia retain exclusive ownership of all native tab reordering.
    bind(window, 'ZenWorkspacesUIUpdate', scheduleRestore);
    bind(window, 'AfterWorkspacesSessionRestore', scheduleRestore);
    bind(window.gBrowser.tabContainer, 'TabGroupCreate', scheduleRestore);
    bind(window.gBrowser.tabContainer, 'TabGroupRemoved', scheduleRestore);
    installMenu();
    restore();
    setTimeout(restore, 1200);
    setTimeout(installMenu, 900);
    return true;
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (restoreTimer !== null) clearTimeout(restoreTimer);
    for (const [node, name, fn, cap] of listeners)
      try { node.removeEventListener(name, fn, cap); } catch (_) {}
    listeners.length = 0;
    menuItem?.remove();
    if (window[KEY] === api) delete window[KEY];
  }
  const api = {start, destroy, createFromTabs, restore,
    debug: () => ({enabled:true, mode:'context-menu-only', dragging:false,
      storedGroups:Object.keys(registry()).length})};
  window[KEY] = api;
  if (document.readyState === 'complete') start();
  else bind(window, 'load', start, {once:true});
  bind(window, 'unload', destroy, {once:true});
})();
