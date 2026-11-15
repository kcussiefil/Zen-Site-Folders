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
  // Like Yab's staged folder decision: reveal → hold progress → commit.
  const HOVER_MS = 120;
  const HOLD_MS = 420;
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
  const SVG = 'http://www.w3.org/2000/svg';
  let progress = null, holdTimer = null;
  // Zia moves sibling rows via inline translateY during dragover; capture the
  // true row slots once, then never chase those animated DOM hit targets.
  function slotOf(tab) {
    const rect = tab?.getBoundingClientRect?.();
    if (!rect || rect.height < 15 || rect.width < 32) return null;
    const dy = tab.hasAttribute?.('zia-shift') ?
      parseFloat(tab.style?.getPropertyValue?.('--zia-drag-y')) || 0 : 0;
    return {left:rect.left,right:rect.right,top:rect.top-dy,
      bottom:rect.bottom-dy,height:rect.height,width:rect.width};
  }
  function targetAt(event) {
    if (!drag) return null;
    const {clientX:x, clientY:y} = event;
    // A revealed choice owns its target until the hand leaves the original
    // row's band, just as Yab locks formingPointerY on a held folder.
    if (drag.hover) {
      const here = drag.slots.get(drag.hover);
      if (here && x >= here.left && x <= here.right &&
          y >= here.top + here.height * .05 &&
          y <= here.bottom - here.height * .05 &&
          eligible(drag.hover)) return drag.hover;
    }
    let candidate = null, best = Infinity;
    for (const tab of drag.targets) {
      if (!eligible(tab) || workspace(tab) !== drag.workspace) continue;
      const here = drag.slots.get(tab);
      if (!here || x < here.left || x > here.right ||
          y < here.top + here.height * .12 ||
          y > here.bottom - here.height * .12) continue;
      const delta = Math.abs(y - here.top - here.height / 2);
      if (delta < best) { candidate = tab; best = delta; }
    }
    return candidate;
  }
  function neutralizeAvoidance() {
    if (!drag?.hover) return;
    // Zia's window-capture dragover has already placed sibling rows. Undo its
    // visual-only displacement for this merge choice before the frame paints,
    // while retaining all native DOM order and browser tab objects.
    for (const tab of drag.targets) {
      if (!tab?.isConnected || !tab.hasAttribute?.('zia-shift')) continue;
      const style = tab.style;
      if (!style?.setProperty) continue;
      if (!drag.frozen.has(tab))
        drag.frozen.set(tab, {value:style.getPropertyValue('transform'),
          priority:style.getPropertyPriority('transform')});
      style.setProperty('transform', 'none', 'important');
    }
  }
  function unfreeze({committing = false} = {}) {
    if (!drag?.frozen) return;
    for (const [tab, old] of drag.frozen) {
      const style = tab?.style;
      if (!style) continue;
      if (committing) {
        if (style.getPropertyValue('transform') === 'none')
          style.removeProperty('transform');
      } else if (old.value) style.setProperty('transform', old.value, old.priority);
      else style.removeProperty('transform');
    }
    drag.frozen.clear();
  }
  function iconPosition(tab) {
    const slot = drag?.slots.get(tab);
    const native = tab.querySelector?.('.tab-icon-image');
    const iconRect = native?.getBoundingClientRect?.();
    const current = tab.getBoundingClientRect?.();
    if (!slot || !current) return null;
    // Keep the choice exactly over the original favicon position, not over
    // the translating copy Zia may be drawing right now.
    const dx = iconRect ? iconRect.left - current.left : 16;
    return {x:slot.left + dx + 8, y:slot.top + slot.height/2};
  }
  function showProgress(tab) {
    if (!drag || drag.hover !== tab || !eligible(tab)) return;
    const pos = iconPosition(tab);
    if (!pos) return;
    if (!progress) {
      progress = document.createElementNS(NS, 'div');
      progress.id = 'zsf-manual-merge-progress';
      const image = document.createElementNS(NS, 'img');
      image.setAttribute('src', nativeIcon(tab));
      image.setAttribute('aria-hidden', 'true');
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('viewBox','0 0 32 32');
      svg.setAttribute('aria-hidden','true');
      for (const cls of ['zsf-manual-progress-track','zsf-manual-progress-fill']) {
        const circle = document.createElementNS(SVG,'circle');
        circle.setAttribute('cx','16');circle.setAttribute('cy','16');
        circle.setAttribute('r','13');
        circle.setAttribute('class',cls);
        svg.appendChild(circle);
      }
      progress.append(image,svg);
      document.documentElement.appendChild(progress);
    }
    const image = progress.querySelector?.('img') || progress.children?.[0];
    if (image?.getAttribute?.('src') !== nativeIcon(tab))
      image?.setAttribute?.('src', nativeIcon(tab));
    progress.style.left = Math.round(pos.x-16)+'px';
    progress.style.top = Math.round(pos.y-16)+'px';
    progress.style.setProperty?.('--zsf-hold-ms',HOLD_MS+'ms');
    tab.setAttribute('data-zsf-manual-progress','true');
    // Trigger keyframes only once per chosen target; the animation and ready
    // timer start together, not on every dragover.
    progress.setAttribute('data-running','true');
    holdTimer = setTimeout(() => {
      holdTimer = null;
      if (destroyed || !drag || drag.hover !== tab || !eligible(tab)) return;
      drag.ready = tab;
      tab.setAttribute('data-zsf-manual-ready','true');
      progress?.setAttribute('data-complete','true');
    }, HOLD_MS);
  }
  function clearCandidate({committing = false} = {}) {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    if (holdTimer !== null) clearTimeout(holdTimer);
    hoverTimer = null; holdTimer = null;
    for (const tab of [drag?.hover, drag?.ready]) {
      tab?.removeAttribute?.('data-zsf-manual-progress');
      tab?.removeAttribute?.('data-zsf-manual-ready');
      tab?.removeAttribute?.('data-zsf-manual-hover');
    }
    progress?.remove(); progress = null;
    unfreeze({committing});
    if (drag) { drag.hover = null; drag.ready = null; }
  }
  function clearDrag(options) { clearCandidate(options); drag = null; }
  function onDragStart(event) {
    clearDrag();
    if (!enabled()) return;
    const source = tabFromEvent(event);
    if (!eligible(source) || source.multiselected) return;
    let payload = null;
    try { payload = event.dataTransfer?.mozGetDataAt?.('application/x-moz-tabbrowser-tab',0); }
    catch (_) {}
    if (payload && payload !== source) return;
    const targets = [...(window.gBrowser?.tabs || [])].filter(tab =>
      tab !== source && eligible(tab) && workspace(tab) === workspace(source));
    const slots = new Map(targets.map(tab => [tab,slotOf(tab)]));
    drag = {source,workspace:workspace(source),targets,slots,
      verified:payload===source,hover:null,ready:null,frozen:new Map()};
  }
  function onDragOver(event) {
    if (!drag || !drag.source?.isConnected || !enabled() ||
        drag.source.group || drag.source.pinned) { clearDrag(); return; }
    if (!drag.verified) {
      let payload = null;
      try { payload = event.dataTransfer?.mozGetDataAt?.('application/x-moz-tabbrowser-tab',0); }
      catch (_) {}
      if (payload !== drag.source) { clearDrag(); return; }
      drag.verified = true;
    }
    const target = targetAt(event);
    if (target && drag.hover === target) {
      event.preventDefault();
      // Keep native Zia target-row avoidance from fighting the locked choice.
      event.stopPropagation();
      neutralizeAvoidance();
      return;
    }
    if (target !== drag.hover) clearCandidate();
    if (!target) return; // Edges remain normal Zen/Zia reorder zones.
    drag.hover = target;
    event.preventDefault();
    event.stopPropagation();
    neutralizeAvoidance();
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      if (destroyed || !drag || drag.hover !== target || !eligible(target)) return;
      showProgress(target);
    }, HOVER_MS);
  }
  function onDrop(event) {
    lastDrop = 'received';
    if (!drag?.ready || !enabled()) {
      lastDrop = 'not-ready'; clearDrag(); return;
    }
    let payload = null;
    try { payload = event.dataTransfer?.mozGetDataAt?.('application/x-moz-tabbrowser-tab',0); }
    catch (_) {}
    if (payload !== drag.source) { lastDrop = 'wrong-payload'; clearDrag(); return; }
    const target = drag.ready;
    const tabs = validTabs([drag.source,target]);
    if (!tabs || typeof window.gBrowser?.addTabGroup !== 'function') {
      lastDrop = 'invalid-tabs'; clearDrag(); return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const dnd = window.gBrowser?.tabContainer?.tabDragAndDrop;
    if (dnd) dnd._dontAnimateTabMove = true;
    // Normalize the two moving tab rows BEFORE changing their native parent.
    // Zia has already handled the initial window-capture drop. Any surviving
    // per-tab translation is a stale reorder offset, not part of the final group.
    const normalized = [];
    for (const tab of tabs) {
      tab.setAttribute('data-zsf-manual-committing','true');
      const style = tab.style;
      if (style?.setProperty) {
        style.setProperty('transform','none','important');
        normalized.push(tab);
      }
      for (const animation of tab.getAnimations?.() || []) {
        if (animation.id === 'zia-land') animation.cancel();
      }
    }
    const result = createFromTabs(tabs);
    if (result) result.setAttribute('data-zsf-manual-committing','true');
    lastDrop = result ? 'created' : 'creation-failed';
    clearDrag({committing:!!result});
    const unmark = () => {
      for (const tab of normalized) {
        if (tab.style?.getPropertyValue?.('transform') === 'none')
          tab.style.removeProperty('transform');
      }
      for (const tab of tabs) tab.removeAttribute('data-zsf-manual-committing');
      result?.removeAttribute?.('data-zsf-manual-committing');
    };
    const frame = window.requestAnimationFrame?.bind(window);
    if (frame) frame(() => frame(unmark)); // First frame has correct final DOM.
    else setTimeout(unmark,0);
    if (result && event.dataTransfer) event.dataTransfer.dropEffect='move';
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
