// ==UserScript==
// @name         Zen Site Folders — 拖曳及多選建立普通群組
// @version      1.0.4
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
  // Candidate stays motionless during the short stability check, then the
  // user-configurable horizontal fill runs. Ordinary sorting starts only
  // after the pointer crosses the destination's central band.
  const HOVER_MS = 150;
  const DEFAULT_HOLD_SECONDS = 1.2;
  const HOLD_PREF = 'zen.sitefolders.manual_group_drag.hold_seconds';
  const CENTER_START = .30, CENTER_END = .70;
  const HYSTERESIS_PX = 5;
  function holdMs() {
    let raw = String(DEFAULT_HOLD_SECONDS);
    try { raw = Services.prefs.getStringPref(HOLD_PREF,raw); } catch (_) {}
    const n = Number(String(raw).trim());
    return (Number.isFinite(n)
      ? Math.round(Math.max(.3,Math.min(2.5,n))*10) : 12)*100;
  }
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
  function createFromTabs(input, {dragSource = null, anchor = null} = {}) {
    const validated = validTabs(input);
    // The dragged tab must be first for either drop direction. The native
    // group itself stays at the original upper row; no visual re-sort pass.
    const tabs = validated && dragSource && validated.includes(dragSource) ?
      [dragSource, ...validated.filter(tab => tab !== dragSource)] : validated;
    const before = validated && anchor && validated.includes(anchor) ?
      anchor : validated?.[0];
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
      if (dragSource && [...(group.tabs || [])].some((tab, i) => tab !== tabs[i]))
        console.warn(TAG, 'Native Zen returned unexpected manual group order');
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

  function tabFromEvent(event) {
    for (const node of event.composedPath?.() || [event.target]) {
      const tab = node?.localName === 'tab' ? node :
        node?.closest?.('.tabbrowser-tab');
      if (tab?.localName === 'tab') return tab;
    }
    return null;
  }
  // Both original rows are represented by viewport-fixed root overlays.
  // Neither preview node may be a child of a Zia-transformed native tab.
  // We capture natural slots before Zia's dragover neighbour translations.
  let choice = null, pair = null, holdTimer = null;
  function slotOf(tab) {
    const rect = tab?.getBoundingClientRect?.();
    if (!rect || rect.height < 15 || rect.width < 32) return null;
    let dy=tab.hasAttribute?.('zia-shift') ?
      parseFloat(tab.style?.getPropertyValue?.('--zia-drag-y')) || 0 : 0;
    // The dragged SOURCE may already have a Zia translate when our capture
    // handler runs. Read its natural row slot, not its moved visual ghost.
    if (!tab.hasAttribute?.('zia-shift') && tab.hasAttribute?.('zia-dragging')) {
      try {
        const style=window.getComputedStyle?.(tab);
        const transform=style?.transform;
        if (transform && transform!=='none' && typeof DOMMatrix==='function')
          dy+=new DOMMatrix(transform).m42;
        const translate=style?.translate;
        if (translate && translate!=='none')
          dy+=parseFloat(translate.split(/\s+/)[1])||0;
      } catch (_) { /* Captured native rect remains a safe fallback. */ }
    }
    return {left:rect.left,right:rect.right,top:rect.top-dy,
      bottom:rect.bottom-dy,height:rect.height,width:rect.width};
  }
  function scrollPorts(tab) {
    const ws=workspace(tab);
    const candidates=[ws?.scrollbox?.scrollbox,ws?.scrollbox,
      ws?.querySelector?.('.workspace-arrowscrollbox')?.scrollbox,
      ws?.querySelector?.('.workspace-arrowscrollbox'),
      window.gZenWorkspaces?.activeWorkspaceElement?.scrollbox?.scrollbox];
    return [...new Set(candidates.filter(node =>
      node && typeof node.scrollTop==='number' &&
      node.scrollHeight>node.clientHeight+3))].map(node=>({node,top:node.scrollTop}));
  }
  function scrollOffset() {
    return (drag?.scrolls||[]).reduce((delta,item)=>
      delta+item.node.scrollTop-item.top,0);
  }
  function setPortalBounds(node,box) {
    if (!node || !box) return;
    const top=box.top-scrollOffset();
    node.style.setProperty('left',box.left+'px');
    node.style.setProperty('top',top+'px');
    node.style.setProperty('width',box.width+'px');
    node.style.setProperty('height',box.height+'px');
    // A root-level overlay must not leak over the URL bar when tabs scroll.
    const clip=drag?.scrolls?.[0]?.node?.getBoundingClientRect?.();
    node.hidden=!!(clip && (top>=clip.bottom || top+box.height<=clip.top));
  }
  function positionPortals() {
    if (!drag?.previewSlots) return;
    setPortalBounds(choice,drag.previewSlots.upper);
    setPortalBounds(pair,drag.previewSlots.lower);
  }
  function carryTabPaint(node,tab) {
    // Root overlays do not inherit tab-scoped Zia variables. Copy just the
    // computed theme tokens; never force a hard-coded light/dark paint.
    if (!node) return;
    try {
      const paint=window.getComputedStyle?.(tab);
      for (const [from,to] of [
        ['--zia-tab-hover-bg','--zsf-manual-preview-bg'],
        ['--zia-sidebar-ink','--zsf-manual-preview-ink'],
        ['--zia-tab-radius','--zsf-manual-preview-radius']]) {
        const value=paint?.getPropertyValue?.(from)?.trim();
        if (value) node.style.setProperty(to,value);
      }
    } catch (_) { /* Root theme variables are the safe CSS fallback. */ }
  }
  function targetAt(event) {
    if (!drag) return null;
    const {clientX:x,clientY:y} = event;
    const offset=scrollOffset();
    const phaseOf = (tab, here) => {
      if (!here || x < here.left || x > here.right ||
          y < here.top-offset || y > here.bottom-offset) return null;
      const ratio = (y-(here.top-offset))/here.height;
      const tolerance = Math.min(.12,HYSTERESIS_PX/here.height);
      const centerStart = CENTER_START-(drag.hover===tab?tolerance:0);
      const centerEnd = CENTER_END+(drag.hover===tab?tolerance:0);
      if (ratio >= centerStart && ratio <= centerEnd) return 'center';
      // On approach, guard the upstream edge against Zia's eager avoidance.
      // On the far edge (after crossing the centre), let native sorting run.
      const down = drag.sourceSlot?.top <= here.top;
      return down ? (ratio < centerStart ? 'guard' : 'sort') :
        (ratio > centerEnd ? 'guard' : 'sort');
    };
    if (drag.hover) {
      const here = drag.slots.get(drag.hover);
      const phase=phaseOf(drag.hover,here);
      if (phase) return {tab:drag.hover,phase};
    }
    let closest=null,best=Infinity;
    for (const tab of drag.targets) {
      if (!eligible(tab) || workspace(tab)!==drag.workspace) continue;
      const here=drag.slots.get(tab);
      const phase=phaseOf(tab,here);
      if (!phase) continue;
      const distance=Math.abs(y-(here.top-offset)-here.height/2);
      if (distance<best) {closest={tab,phase};best=distance;}
    }
    return closest;
  }
  function neutralizeAvoidance() {
    // CSS lock beats inline Zia shift even if Zia's earlier capture listener
    // ran first. We never overwrite Zia's inline transform or native DOM order.
    if (drag?.guard)
      window.gBrowser?.tabContainer?.setAttribute('data-zsf-manual-guard','true');
  }
  function unfreeze() {
    window.gBrowser?.tabContainer?.removeAttribute('data-zsf-manual-guard');
  }
  function makeChoice(tab) {
    if (!drag || drag.hover !== tab || !eligible(tab)) return;
    const source=drag.source;
    const s=drag.sourceSlot,t=drag.slots.get(tab);
    const adjacent=!!s && !!t &&
      Math.abs(s.top-t.top)<=Math.max(s.height,t.height)*1.9;
    const upper=adjacent && s.top<t.top ? source : tab;
    const lower=adjacent ? (upper===source?tab:source) : null;
    choice=document.createElementNS(NS,'div');
    choice.className='zsf-manual-merge-choice';
    choice.id='zsf-manual-merge-choice';
    choice.setAttribute('aria-hidden','true');
    const fill=document.createElementNS(NS,'div');
    fill.className='zsf-manual-merge-fill';
    const icon=document.createElementNS(NS,'img');
    icon.className='zsf-manual-merge-icon';
    icon.setAttribute('src',FOLDER_ICON);
    const title=document.createElementNS(NS,'span');
    title.className='zsf-manual-merge-title';
    title.textContent='新群組';
    const count=document.createElementNS(NS,'span');
    count.className='zsf-manual-merge-count';
    count.textContent='2';
    choice.append(fill,icon,title,count);
    const ms=holdMs();
    choice.style.setProperty?.('--zsf-hold-ms',ms+'ms');
    document.documentElement.appendChild(choice);
    carryTabPaint(choice,upper);
    upper.setAttribute('data-zsf-manual-choice','true');
    drag.visualTabs=[upper];
    drag.previewSlots={upper:upper===source?s:t,lower:lower===source?s:t};
    if (lower) {
      pair=document.createElementNS(NS,'div');
      pair.id='zsf-manual-pair';
      pair.className='zsf-manual-pair';
      pair.setAttribute('aria-hidden','true');
      for (const member of [source,tab]) {
        const image=document.createElementNS(NS,'img');
        image.className='zsf-manual-pair-icon';
        image.setAttribute('src',nativeIcon(member));
        pair.appendChild(image);
      }
      const offset=(upper===tab && source===lower) ? (t.top-s.top) : 0;
      pair.style.setProperty?.('--zsf-pair-start-y',offset+'px');
      document.documentElement.appendChild(pair);
      carryTabPaint(pair,lower);
      lower.setAttribute('data-zsf-manual-pair','true');
      drag.visualTabs.push(lower);
      // B upward into A: overlapped favicons start on A, glide into B's
      // original slot. A downward into B: the pair is already in B's slot.
      if (!offset) pair.setAttribute('data-settled','true');
      else {
        const activePair=pair;
        const frame=()=> {
          if (drag?.hover===tab && activePair.isConnected)
            activePair.setAttribute('data-settled','true');
        };
        const raf=window.requestAnimationFrame?.bind(window);
        if (raf) drag.pairFrame=raf(()=>{drag.pairFrame=raf(frame);});
        else drag.pairTimer=setTimeout(frame,20);
      }
    }
    positionPortals();
    choice.setAttribute('data-running','true');
    holdTimer=setTimeout(()=>{
      holdTimer=null;
      if (destroyed || !drag || drag.hover!==tab || !eligible(tab)) return;
      drag.ready=tab;
      tab.setAttribute('data-zsf-manual-ready','true');
      choice?.setAttribute('data-ready','true');
    },ms);
  }
  function clearCandidate({committing=false}={}) {
    if (hoverTimer!==null) clearTimeout(hoverTimer);
    if (holdTimer!==null) clearTimeout(holdTimer);
    if (drag?.pairFrame) window.cancelAnimationFrame?.(drag.pairFrame);
    if (drag?.pairTimer) clearTimeout(drag.pairTimer);
    hoverTimer=null;holdTimer=null;
    for (const tab of [drag?.hover,drag?.ready]) {
      tab?.removeAttribute?.('data-zsf-manual-ready');
    }
    for (const tab of drag?.visualTabs||[]) {
      tab?.removeAttribute?.('data-zsf-manual-choice');
      tab?.removeAttribute?.('data-zsf-manual-pair');
    }
    choice?.remove();pair?.remove();
    choice=null;pair=null;
    unfreeze({committing});
    if (drag) {
      drag.hover=null;drag.ready=null;drag.guard=null;
      drag.visualTabs=[];drag.previewSlots=null;
      drag.pairFrame=0;drag.pairTimer=null;
    }
  }
  function clearDrag(options) {clearCandidate(options);drag=null;}
  function onDragStart(event) {
    finishLanding();
    clearDrag();
    if (!enabled()) return;
    const source=tabFromEvent(event);
    if (!eligible(source) || source.multiselected) return;
    let payload=null;
    try {payload=event.dataTransfer?.mozGetDataAt?.('application/x-moz-tabbrowser-tab',0);}
    catch (_) {}
    if (payload && payload!==source) return;
    try {
      const icon=source.querySelector?.('.tab-icon-image');
      if (icon && event.dataTransfer?.setDragImage)
        event.dataTransfer.setDragImage(icon,8,8);
    } catch (_) {}
    const targets=[...(window.gBrowser?.tabs||[])].filter(tab=>
      tab!==source && eligible(tab) && workspace(tab)===workspace(source));
    const slots=new Map(targets.map(tab=>[tab,slotOf(tab)]));
    drag={source,sourceSlot:slotOf(source),workspace:workspace(source),
      targets,slots,scrolls:scrollPorts(source),verified:payload===source,
      hover:null,ready:null,guard:null,visualTabs:[],previewSlots:null,
      pairFrame:0,pairTimer:null};
  }
  function onDragOver(event) {
    if (!drag || !drag.source?.isConnected || !enabled() ||
        drag.source.group || drag.source.pinned) {clearDrag();return;}
    if (!drag.verified) {
      let payload=null;
      try {payload=event.dataTransfer?.mozGetDataAt?.('application/x-moz-tabbrowser-tab',0);}
      catch (_) {}
      if (payload!==drag.source) {clearDrag();return;}
      drag.verified=true;
    }
    // Keep root-level previews aligned with their original *layout* slots
    // on sidebar scroll, never with Zia's translated source/target elements.
    positionPortals();
    const hit=targetAt(event);
    const target=hit?.tab||null;
    if (!target || hit.phase==='sort') {
      if (drag.guard || drag.hover) clearCandidate();
      return; // Crossing the far edge releases Zen/Zia's normal reorder.
    }
    if (drag.hover && (drag.hover!==target || hit.phase!=='center'))
      clearCandidate();
    drag.guard=target;
    neutralizeAvoidance();
    event.preventDefault();
    event.stopPropagation();
    if (hit.phase==='guard' || drag.hover===target) return;
    drag.hover=target;
    hoverTimer=setTimeout(()=>{
      hoverTimer=null;
      if (destroyed || !drag || drag.hover!==target || !eligible(target)) return;
      makeChoice(target);
    },HOVER_MS);
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
  }
  function onDragEnd() {
    clearDrag();
    if (!settling) return;
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
      lastDrop='not-ready';
      // A release inside the still-pending central zone is cancellation,
      // never an accidental native reorder after a prevented dragover.
      if (enabled() && drag?.hover && drag.guard) {
        event.preventDefault();event.stopImmediatePropagation();
      }
      clearDrag();return;
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
    // Never modify Zen's global tabDragAndDrop animation flag: doing so
    // can break subsequent ordinary tab reorders and leave stale moves.
    // Avoid Zia's stale reorder transform in the same paint as native
    // addTabGroup(). It is a temporary, scoped commit state, not a global
    // transition setting.
    for (const tab of original) {
      tab.setAttribute('data-zsf-manual-committing','true');
      tab.style?.setProperty?.('transform','none','important');
    }
    // Place the new group at the original upper slot; member order is
    // always dragged source FIRST, hovered destination SECOND.
    const sourceTop=drag.sourceSlot?.top ?? Infinity;
    const targetTop=drag.slots.get(target)?.top ?? Infinity;
    const anchor=sourceTop<=targetTop ? source : target;
    const group=createFromTabs([source,target],{dragSource:source,anchor});
    if (group) group.setAttribute('data-zsf-manual-committing','true');
    lastDrop=group?'created':'creation-failed';
    clearDrag({committing:!!group});
    if (group) {
      finishLanding(); // Never carry state over from another operation.
      settling={tabs:original,group,backup:null};
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
    bind(window, 'scroll', positionPortals, true);
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
      candidate: !!drag?.ready, portal:!!choice?.isConnected,
      phase:drag?.hover?'center':drag?.guard?'guard':'none',
      holdMs:holdMs(), stableMs:HOVER_MS, lastDrop,
      storedGroups: Object.keys(registry()).length})};
  window[KEY] = api;
  if (document.readyState === 'complete') start();
  else bind(window, 'load', start, {once:true});
  bind(window, 'unload', destroy, {once:true});
})();
