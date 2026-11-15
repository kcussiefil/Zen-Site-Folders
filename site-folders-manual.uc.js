// ==UserScript==
// @name         Zen Site Folders — 拖曳及多選建立普通群組
// @version      1.0.2
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
  // Match Yab TabDropChoice: revealDelay 0.18 s, folderHold 0.5 s.
  const HOVER_MS = 180;
  const HOLD_MS = 500;
  const listeners = [];
  let destroyed = false, started = false, drag = null, hoverTimer = null;
  let lastDrop = 'none';
  let menuItem = null, restoreTimer = null, settling = null;
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
  function createFromTabs(input, {dragTarget = null} = {}) {
    const validated = validTabs(input);
    // Native Zen uses insertBefore.before(group). For a drag merge, anchor
    // at the tab UNDER the cursor, not whichever tab currently sorts first
    // after native/Zia dragover. This mirrors Yab's [other, dragged] order.
    const tabs = validated && dragTarget && validated.includes(dragTarget) ?
      [dragTarget, ...validated.filter(tab => tab !== dragTarget)] : validated;
    const browser = window.gBrowser;
    if (!tabs || typeof browser?.addTabGroup !== 'function' ||
        !sessionStore?.setCustomWindowValue) return null;
    const info = details(tabs);
    let group;
    try {
      group = browser.addTabGroup(tabs, {
        label: info.title,
        color: 'gray',
        insertBefore: dragTarget || tabs[0],
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
  // Yab's choice replaces the destination row contents; it is not a floating
  // translucent overlay. The genuine native tab remains in place until drop.
  let choice = null, holdTimer = null;
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
    // Yab retains a ready target even when the surrounding layout moves.
    // Disengage only when the pointer leaves its original central band.
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
    // Keep the native DOM order intact; suppress just Zia's visual shift
    // while this choice is active. The original styles restore on cancel.
    for (const tab of drag.targets) {
      if (!tab?.isConnected || !tab.hasAttribute?.('zia-shift')) continue;
      const style = tab.style;
      if (!style?.setProperty) continue;
      if (!drag.frozen.has(tab))
        drag.frozen.set(tab, {value:style.getPropertyValue('transform'),
          priority:style.getPropertyPriority('transform')});
      style.setProperty('transform','none','important');
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
      } else if (old.value) style.setProperty('transform',old.value,old.priority);
      else style.removeProperty('transform');
    }
    drag.frozen.clear();
  }
  function makeChoice(tab) {
    if (!drag || drag.hover !== tab || !eligible(tab)) return;
    const stack = tab.querySelector?.('.tab-stack') || tab;
    choice = document.createElementNS(NS,'div');
    choice.className='zsf-manual-merge-choice';
    choice.id='zsf-manual-merge-choice';
    choice.setAttribute('aria-hidden','true');
    const fill=document.createElementNS(NS,'div');
    fill.className='zsf-manual-merge-fill';
    const icon=document.createElementNS(NS,'img');
    icon.className='zsf-manual-merge-icon';
    icon.setAttribute('src',nativeIcon(tab));
    const title=document.createElementNS(NS,'span');
    title.className='zsf-manual-merge-title';
    title.textContent='新群組';
    const count=document.createElementNS(NS,'span');
    count.className='zsf-manual-merge-count';
    count.textContent='2';
    choice.append(fill,icon,title,count);
    choice.style.setProperty?.('--zsf-hold-ms',HOLD_MS+'ms');
    stack.appendChild(choice);
    tab.setAttribute('data-zsf-manual-choice','true');
    // The horizontal bar starts now; don't restart it on each dragover.
    choice.setAttribute('data-running','true');
    holdTimer=setTimeout(()=>{
      holdTimer=null;
      if (destroyed || !drag || drag.hover !== tab || !eligible(tab)) return;
      drag.ready=tab;
      tab.setAttribute('data-zsf-manual-ready','true');
      choice?.setAttribute('data-ready','true');
      icon.setAttribute('src',FOLDER_ICON);
    },HOLD_MS);
  }
  function clearCandidate({committing = false} = {}) {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    if (holdTimer !== null) clearTimeout(holdTimer);
    hoverTimer = null; holdTimer = null;
    for (const tab of [drag?.hover,drag?.ready]) {
      tab?.removeAttribute?.('data-zsf-manual-choice');
      tab?.removeAttribute?.('data-zsf-manual-ready');
    }
    choice?.remove(); choice=null;
    unfreeze({committing});
    if (drag) { drag.hover = null; drag.ready = null; }
  }
  function clearDrag(options) { clearCandidate(options); drag = null; }
  function onDragStart(event) {
    finishLanding();
    clearDrag();
    if (!enabled()) return;
    const source = tabFromEvent(event);
    if (!eligible(source) || source.multiselected) return;
    let payload = null;
    try { payload = event.dataTransfer?.mozGetDataAt?.('application/x-moz-tabbrowser-tab',0); }
    catch (_) {}
    if (payload && payload !== source) return;
    // Prefer the small site favicon as the native drag ghost (like Yab).
    // Gecko or Zia may override the image later; never break native drag on
    // browsers which do not support XUL images in setDragImage().
    try {
      const icon=source.querySelector?.('.tab-icon-image');
      if (icon && event.dataTransfer?.setDragImage)
        event.dataTransfer.setDragImage(icon,8,8);
    } catch (_) { /* Native Zen drag image remains the safe fallback. */ }
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
      makeChoice(target);
    }, HOVER_MS);
  }
  function finishLanding() {
    const item=settling;
    if (!item) return;
    settling=null;
    if (item.backup !== null) clearTimeout(item.backup);
    for (const tab of item.tabs) {
      // This is our temporary forced transform, never clear a later native
      // or Zia value that was applied during an unrelated new drag.
      if (tab.style?.getPropertyValue?.('transform') === 'none')
        tab.style.removeProperty('transform');
      tab.removeAttribute('data-zsf-manual-committing');
    }
    item.group?.removeAttribute?.('data-zsf-manual-committing');
    if (item.dnd) item.dnd._dontAnimateTabMove=item.oldAnimation;
  }
  function onDragEnd() {
    clearDrag();
    if (!settling) return;
    // Restore the native drag flag synchronously: subsequent drag gestures
    // can begin before the next frame. The visual commit marker can remain
    // until the first settled paint without affecting the drag engine.
    if (settling.dnd) settling.dnd._dontAnimateTabMove=settling.oldAnimation;
    // Zia and Gecko finish their drag-end cleanup first (they registered
    // earlier on window capture). Resume transitions after the layout and
    // the group's native membership are both settled.
    const frame=window.requestAnimationFrame?.bind(window);
    if (frame) frame(()=>frame(finishLanding));
    else finishLanding();
  }
  function onDrop(event) {
    lastDrop='received';
    if (!drag?.ready || !enabled()) {
      lastDrop='not-ready';clearDrag();return;
    }
    let payload=null;
    try {payload=event.dataTransfer?.mozGetDataAt?.('application/x-moz-tabbrowser-tab',0);}
    catch (_) {}
    if (payload !== drag.source) {lastDrop='wrong-payload';clearDrag();return;}
    const target=drag.ready,source=drag.source;
    const original=validTabs([source,target]);
    if (!original || typeof window.gBrowser?.addTabGroup !== 'function') {
      lastDrop='invalid-tabs';clearDrag();return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const dnd=window.gBrowser?.tabContainer?.tabDragAndDrop;
    const oldAnimation=dnd?dnd._dontAnimateTabMove:undefined;
    if (dnd) dnd._dontAnimateTabMove=true;
    // Avoid Zia's stale reorder transform in the same paint as native
    // addTabGroup(). It is a temporary, scoped commit state, not a global
    // transition setting.
    for (const tab of original) {
      tab.setAttribute('data-zsf-manual-committing','true');
      tab.style?.setProperty?.('transform','none','important');
    }
    // addTabGroup inserts the container before "insertBefore" in Zen's
    // Tabbrowser patch. Target-first order is deterministic regardless of
    // transient gBrowser.tabs sorting during a drag. No second reorder pass.
    const group=createFromTabs([target,source],{dragTarget:target});
    if (group) group.setAttribute('data-zsf-manual-committing','true');
    lastDrop=group?'created':'creation-failed';
    clearDrag({committing:!!group});
    if (group) {
      finishLanding(); // Never carry state over from another operation.
      settling={tabs:original,group,dnd,oldAnimation,backup:null};
      // Safety fallback for platforms where a DOM-reparented tab never
      // dispatches dragend. This is cleanup, not a timer-based reorder.
      settling.backup=setTimeout(finishLanding,350);
      if (event.dataTransfer) event.dataTransfer.dropEffect='move';
    } else {
      for(const tab of original) {
        if(tab.style?.getPropertyValue?.('transform')==='none')
          tab.style.removeProperty('transform');
        tab.removeAttribute('data-zsf-manual-committing');
      }
      if (dnd) dnd._dontAnimateTabMove=oldAnimation;
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
    bind(window, 'dragend', onDragEnd, true);
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
    finishLanding();
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
