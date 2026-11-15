// ==UserScript==
// @name         Zen Site Folders — 拖曳及多選建立普通群組
// @version      1.0.1
// @description  Opt-out-safe manual grouping for unpinned Zen tabs; no live DOM reorder.
// @include      chrome://browser/content/browser.xhtml
// ==/UserScript==
(() => {
  'use strict';
  const KEY = '__zsfManualGroupsV099';
  if (window[KEY]?.destroy) window[KEY].destroy();
  const TAG = '[ZenSiteFoldersManual]';
  const PREF = 'zen.sitefolders.manual_group_drag.enabled';
  const STORE = 'zsf-manual-groups-v1';
  const NS = 'http://www.w3.org/1999/xhtml';
  const FOLDER_ICON = 'chrome://browser/skin/zen-icons/folder.svg';
  const HOVER_MS = 95;
  const listeners = [];
  let destroyed = false, started = false, drag = null, hoverTimer = null;
  let lastDrop = 'none';
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
  function enabled() {
    try { return Services.prefs.getBoolPref(PREF, true); }
    catch (_) { return true; }
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
    const browser = window.gBrowser;
    if (!tabs || typeof browser?.addTabGroup !== 'function' ||
        !sessionStore?.setCustomWindowValue) return null;
    const info = details(tabs);
    let group;
    try {
      group = browser.addTabGroup(tabs, {
        label: info.title,
        color: 'gray',
        insertBefore: tabs[0],
        showCreateUI: false
      });
      if (!group?.isConnected || group.isZenFolder ||
          tabs.some(tab => tab.group !== group || tab.pinned))
        throw new Error('Native group creation was incomplete');
      if (!group.id) throw new Error('Native group has no stable ID');
      // Persist manual ownership by native group ID; native attributes are not
      // guaranteed to survive a restart, while the group and its label do.
      const map = registry();
      map[group.id] = {kind: info.kind, icon: info.icon};
      if (!saveRegistry(map))
        console.warn(TAG, 'Group exists but its custom icon may not restore');
      decorate(group, info);
      // Native label creation can finish on the next animation frame.
      scheduleRestore();
      return group;
    } catch (error) {
      // Never close or ungroup a partially created tab on error.
      console.warn(TAG, 'Manual group creation incomplete; original tabs retained', error);
      return null;
    }
  }

  function tabFromEvent(event) {
    for (const node of event.composedPath?.() || [event.target]) {
      const tab = node?.localName === 'tab' ? node :
        node?.closest?.('.tabbrowser-tab');
      if (tab?.localName === 'tab') return tab;
    }
    return null;
  }
  // Zia moves ordinary rows via inline translateY on every dragover.
  // Measure their *unshifted* visual slots, not the translated hit target.
  // This preserves the intended drop target while Zia opens its reorder gap.
  function slotOf(tab) {
    const rect = tab?.getBoundingClientRect?.();
    if (!rect || rect.height < 15 || rect.width < 32) return null;
    let ziaY = parseFloat(tab.style?.getPropertyValue?.('--zia-drag-y')) || 0;
    if (!tab.hasAttribute?.('zia-shift')) ziaY = 0;
    return {left:rect.left,right:rect.right,
      top:rect.top-ziaY,bottom:rect.bottom-ziaY,
      height:rect.height,width:rect.width};
  }
  function targetAt(event) {
    if (!drag) return null;
    const x = event.clientX, y = event.clientY;
    let best = null, bestDist = Infinity;
    // The real DragEvent target often changes while Zia's translated rows
    // pass beneath the pointer. Compare against unshifted positions instead.
    for (const tab of drag.targets) {
      if (!eligible(tab) || tab === drag.source ||
          workspace(tab) !== drag.workspace) continue;
      const rect = slotOf(tab);
      if (!rect || x < rect.left || x > rect.right ||
          y < rect.top + rect.height * .10 ||
          y > rect.bottom - rect.height * .10) continue;
      const distance = Math.abs(y - (rect.top + rect.height / 2));
      if (distance < bestDist) { best = tab; bestDist = distance; }
    }
    return best;
  }
  function releaseShiftFreeze(restore = true) {
    if (!drag?.shiftFrozen) return;
    for (const [tab, old] of drag.shiftFrozen) {
      if (!tab?.style) continue;
      if (restore && tab.isConnected) {
        if (old.value) tab.style.setProperty('transform', old.value, old.priority);
        else tab.style.removeProperty('transform');
      } else if (tab.style.getPropertyValue('transform') === 'none') {
        tab.style.removeProperty('transform');
      }
    }
    drag.shiftFrozen.clear();
  }
  function freezeNativeAvoidance() {
    if (!drag?.hover) return;
    // Scope this to the explicit group target. When the user leaves the
    // merge slot, all original native Zia transforms are restored.
    drag.shiftFrozen ||= new Map();
    for (const tab of drag.targets) {
      if (tab === drag.source || !tab?.isConnected ||
          !tab.hasAttribute?.('zia-shift') || !tab.style) continue;
      const value = tab.style.getPropertyValue('transform');
      const priority = tab.style.getPropertyPriority('transform');
      if (value !== 'none') drag.shiftFrozen.set(tab, {value,priority});
      tab.style.setProperty('transform','none','important');
    }
  }
  function clearCandidate({committing = false} = {}) {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    hoverTimer = null;
    drag?.hover?.removeAttribute?.('data-zsf-manual-hover');
    drag?.ready?.removeAttribute?.('data-zsf-manual-hover');
    if (drag) {
      releaseShiftFreeze(!committing);
      drag.hover = null; drag.ready = null;
    }
  }
  function clearDrag({committing = false} = {}) {
    clearCandidate({committing});
    drag = null;
  }
  function showPreview(tab) {
    if (!drag || drag.hover !== tab || destroyed || !eligible(tab)) return;
    drag.ready = tab;
    tab.setAttribute('data-zsf-manual-hover', 'true');
    freezeNativeAvoidance();
  }
  function onDragStart(event) {
    clearDrag();
    if (!enabled()) return;
    const source = tabFromEvent(event);
    if (!eligible(source) || source.multiselected) return;
    let payload = null;
    try { payload = event.dataTransfer?.mozGetDataAt?.('application/x-moz-tabbrowser-tab', 0); }
    catch (_) {}
    if (payload && payload !== source) return;
    const targets = [...(window.gBrowser?.tabs || [])].filter(tab =>
      tab !== source && eligible(tab) && workspace(tab) === workspace(source));
    drag = {source, workspace:workspace(source), verified:payload===source,
      targets, hover:null, ready:null, shiftFrozen:new Map()};
  }
  function onDragOver(event) {
    if (!drag || !drag.source?.isConnected || !enabled() ||
        drag.source.group || drag.source.pinned) { clearDrag(); return; }
    if (!drag.verified) {
      let payload = null;
      try { payload = event.dataTransfer?.mozGetDataAt?.('application/x-moz-tabbrowser-tab', 0); }
      catch (_) {}
      if (payload !== drag.source) { clearDrag(); return; }
      drag.verified = true;
    }
    const target = targetAt(event);
    if (drag.hover === target) {
      drag.pointer = {x:event.clientX,y:event.clientY};
      if (target) {
        // Already in a merge candidate: don't also allow a native reorder
        // to consume this later dragover. Earlier Zia handlers are visual-only
        // here and are compensated before paint.
        event.preventDefault();
        freezeNativeAvoidance();
      }
      return;
    }
    clearCandidate();
    if (!target) return;
    drag.hover = target;
    drag.pointer = {x:event.clientX,y:event.clientY};
    // Entering a target is unambiguous because we use the stationary,
    // unshifted slot rather than whichever moving row catches the pointer.
    event.preventDefault();
    freezeNativeAvoidance();
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      if (destroyed || !drag || drag.hover !== target) return;
      showPreview(target);
    }, HOVER_MS);
  }
  function onDrop(event) {
    lastDrop = 'received';
    if (!drag?.ready || !enabled()) { lastDrop = 'no-ready'; clearDrag(); return; }
    let payload = null;
    try { payload = event.dataTransfer?.mozGetDataAt?.('application/x-moz-tabbrowser-tab', 0); }
    catch (_) {}
    if (payload !== drag.source) { lastDrop = 'wrong-payload'; clearDrag(); return; }
    // The accepted target was measured from its natural position and frozen
    // while hovered. Do not recalculate it from Zia's release-time transform.
    const target = drag.ready;
    const tabs = validTabs([drag.source, target]);
    if (!tabs || typeof window.gBrowser?.addTabGroup !== 'function') {
      lastDrop = 'invalid-tabs'; clearDrag(); return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    // No native tab-move animation on this ONE accepted group drop.
    // The normal drop/reorder path is untouched in all other cases.
    const dnd = window.gBrowser?.tabContainer?.tabDragAndDrop;
    if (dnd) dnd._dontAnimateTabMove = true;
    const result = createFromTabs(tabs);
    lastDrop = result ? 'created' : 'creation-failed';
    clearDrag({committing:!!result});
    if (result && event.dataTransfer) event.dataTransfer.dropEffect = 'move';
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
    menuItem.setAttribute('label', '建立普通群組');
    menuItem.setAttribute('hidden', 'true');
    popup.appendChild(menuItem);
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
    // Arm in window capture before Zen/Zia can consume native dragstart.
    // Verify the actual tab DataTransfer before showing a merge candidate.
    bind(window, 'dragstart', onDragStart, true);
    // Drop interception is capture-phase, before the native reorder target.
    bind(window, 'dragover', onDragOver, true);
    bind(window, 'drop', onDrop, true);
    bind(window, 'dragend', clearDrag, true);
    bind(window, 'deactivate', clearDrag, true);
    bind(window, 'keydown', e => { if (e.key === 'Escape') clearDrag(); }, true);
    bind(window, 'ZenWorkspacesUIUpdate', () => { clearDrag(); scheduleRestore(); });
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
    clearDrag();
    if (restoreTimer !== null) clearTimeout(restoreTimer);
    for (const [node, name, fn, cap] of listeners)
      try { node.removeEventListener(name, fn, cap); } catch (_) {}
    listeners.length = 0;
    menuItem?.remove();
    if (window[KEY] === api) delete window[KEY];
  }
  const api = {start, destroy, createFromTabs, restore,
    debug: () => ({enabled: enabled(), dragging: !!drag,
      candidate: !!drag?.ready, lastDrop,
      storedGroups: Object.keys(registry()).length})};
  window[KEY] = api;
  if (document.readyState === 'complete') start();
  else bind(window, 'load', start, {once:true});
  bind(window, 'unload', destroy, {once:true});
})();
