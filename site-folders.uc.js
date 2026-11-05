// ==UserScript==
// @name         Zen Site Folders
// @version      0.7.4
// @description  Group all normal tabs by website and show locally cached favicons.
// @include      chrome://browser/content/browser.xhtml
// ==/UserScript==
(() => {
  'use strict';
  if (window.__zenSiteFoldersV037) return;
  window.__zenSiteFoldersV037 = true;

  const TAG = '[ZenSiteFolders]';
  const STORE_KEY = 'zsf-created-at-v1';
  const REAL_OPENED_KEY = 'zsf-opened-at-real-v1';
  const ICON_CLASS = 'zsf-favicon';
  const TAB_UID_KEY = 'zsf-tab-uid-v1';
  const SNAPSHOT_KEY = 'zsf-before-sort-v1';
  const ARCHIVED_SNAPSHOTS_KEY = 'zsf-archived-snapshots-v1';
  const OWNED_GROUPS_KEY = 'zsf-owned-group-sites-v1';
  const MIN_WAVE_MS = 1250;
  const SITE_NAMES = {
    'youtube.com': 'YouTube', 'youtu.be': 'YouTube',
    'github.com': 'GitHub', 'reddit.com': 'Reddit',
    'instagram.com': 'Instagram', 'facebook.com': 'Facebook',
    'x.com': 'X', 'twitter.com': 'X',
    'chatgpt.com': 'ChatGPT', 'openai.com': 'OpenAI',
    'google.com': 'Google', 'drive.google.com': 'Google Drive',
    'docs.google.com': 'Google Docs', 'maps.google.com': 'Google Maps',
    'mail.google.com': 'Gmail', 'gmail.com': 'Gmail',
    'claude.ai': 'Claude', 'claude.com': 'Claude',
    'zen-browser.app': 'Zen', 'twitch.tv': 'Twitch',
    'discord.com': 'Discord', 'notion.so': 'Notion',
    'internal:about': 'About'
  };
  const SEPARATE_HOSTS = new Set([
    'drive.google.com','docs.google.com','maps.google.com','mail.google.com',
    'photos.google.com','calendar.google.com','translate.google.com'
  ]);

  let running = false;
  let initTimer = null;
  let waveFrame = null;
  let waveStart = 0;
  let waveEnding = false;
  let seq = 0;
  // Only newly created tabs are candidates for a new clock. Session restores
  // keep their original saved timestamp, even while content is still unloaded.
  const newTabOpenedAt = new WeakMap();
  let sessionRestoreBusy = false;
  let startupRestorePending = false;
  const closingSiteGroups = new Map();
  let autoUngrouping = false;
  let workspaceRestoreCompleted = false;
  let uidSeq = 0;
  let noticeTimer = null;
  let noticeSerial = 0;
  const legacyBase = Date.now() - 86_400_000;
  let SessionStore = null;
  try {
    ({ SessionStore } = ChromeUtils.importESModule('resource:///modules/sessionstore/SessionStore.sys.mjs'));
  } catch (error) {
    console.warn(TAG, 'SessionStore import unavailable; trying window.SessionStore:', error);
  }

  // Zen exposes the live SessionStore on window (the same API Zia uses).
  // The module import is a backup for startup timing differences.
  function sessionStores() {
    const stores = [];
    try { if (window.SessionStore) stores.push(window.SessionStore); } catch (_) {}
    if (SessionStore && !stores.includes(SessionStore)) stores.push(SessionStore);
    return stores;
  }
  function getSessionStore(...methods) {
    return sessionStores().find(store => methods.every(name =>
      typeof store?.[name] === 'function')) || null;
  }

  // Capture Zen's original session data before native TabGrouped events
  // expand ordinary groups as their restored members connect.
  let startupGroupStates = null;
  function captureStartupGroupStates(startup) {
    if (workspaceRestoreCompleted || !startup.willRestore()) return;
    // This can predate initialize(): do not stamp a restored lazy tab as new.
    startupRestorePending = true;
    const states = new Map();
    for (const savedWindow of startup.state?.windows || []) {
      let owned;
      try { owned = JSON.parse(savedWindow.extData?.[OWNED_GROUPS_KEY] || '{}'); }
      catch (_) { continue; }
      for (const group of savedWindow.groups || []) {
        const site = owned?.[group.id];
        if (typeof site !== 'string' || typeof group.collapsed !== 'boolean') continue;
        const prior = states.get(group.id);
        // Synced windows can contain the same group. Only restore an
        // unambiguous state shared by their saved copies.
        if (states.has(group.id) && (prior?.site !== site || prior.collapsed !== group.collapsed))
          states.set(group.id, null);
        else states.set(group.id, {site, collapsed: group.collapsed});
      }
    }
    startupGroupStates = states;
  }

  function restoreStartupGroupStates() {
    if (workspaceRestoreCompleted) return;
    workspaceRestoreCompleted = true;
    startupRestorePending = false;
    const states = startupGroupStates;
    startupGroupStates = null;
    if (!states?.size) return;
    for (const group of window.gBrowser?.tabContainer?.querySelectorAll('tab-group') || []) {
      const state = states.get(group.id);
      if (!state || group.isZenFolder || group.pinned || group.hasAttribute('split-view-group') ||
          siteOfGroup(group) !== state.site) continue;
      if (group.collapsed !== state.collapsed) group.collapsed = state.collapsed;
    }
  }

  try {
    const {SessionStartup} = ChromeUtils.importESModule('moz-src:///browser/components/sessionstore/SessionStartup.sys.mjs');
    if (SessionStartup.state) captureStartupGroupStates(SessionStartup);
    else SessionStartup.onceInitialized.then(() => captureStartupGroupStates(SessionStartup));
  } catch (_) {} // Keep native restore behavior when the startup API is unavailable.
  window.addEventListener('AfterWorkspacesSessionRestore', () => {
    // Finish native and Zia restore listeners before changing the group.
    queueMicrotask(restoreStartupGroupStates);
  }, {once:true});

  // Zen resolves promiseInitialized AFTER dispatching
  // AfterWorkspacesSessionRestore (ZenSpaceManager.mjs, onWindowRestored).
  // Sine or native test loading after the event must still release the pending
  // session-restore guard. A settled promise runs this immediately in a
  // microtask; no timeout, guessed timestamps or restored-tab reloads.
  function watchWorkspaceInitialization() {
    const promise = window.gZenWorkspaces?.promiseInitialized;
    if (!promise || typeof promise.then !== 'function') return;
    promise.then(() => restoreStartupGroupStates()).catch(error => {
      console.warn(TAG, 'Zen workspace restore readiness unavailable:', error);
    });
  }

  function workspace() {
    const ws = window.gZenWorkspaces;
    const id = ws?.activeWorkspace;
    const node = id && (ws?.activeWorkspaceElement || ws?.workspaceElement?.(id));
    return id && node ? { id, node } : null;
  }

  function allWorkspaceTabs(node, id) {
    const tabs = new Set();
    for (const holder of [node.pinnedTabsContainer, node.tabsContainer]) {
      holder?.querySelectorAll('tab').forEach(tab => {
        // The group wrapper belongs to this workspace; Zen may omit the
        // workspace attribute on member tabs after native grouping.
        if (tab?.isConnected && !tab.hasAttribute('cloned')) tabs.add(tab);
      });
    }
    // Native fallback for Zen builds with different workspace wrappers.
    if (!tabs.size) {
      for (const tab of (window.gBrowser?.tabs || [])) {
        if (tab.getAttribute('zen-workspace-id') === id) tabs.add(tab);
      }
    }
    return [...tabs];
  }

  function tabURL(tab) {
    const valid = raw => typeof raw === 'string' && /^(?:https?:\/\/|about:)/i.test(raw);
    for (const raw of [
      tab?.linkedBrowser?.currentURI?.spec,
      tab?.getAttribute('linkedpanel-url'),
      tab?.getAttribute('url')
    ]) {
      if (valid(raw)) return raw;
    }
    // Restored/sleeping tabs may only carry their URL in SessionStore.
    try {
      const json = getSessionStore('getTabState')?.getTabState(tab);
      if (json) {
        const state = JSON.parse(json);
        const entry = state.entries?.[(state.index || state.entries?.length || 1) - 1];
        if (valid(entry?.url)) return entry.url;
      }
    } catch (_) {}
    return null;
  }

  function siteFor(raw) {
    // All real about: pages share a single non-network site group. Exclude
    // new-tab/home placeholders which Zen can create synthetically.
    if (/^about:(?:newtab|home|blank)(?:[?#]|$)/i.test(raw || '')) return null;
    if (/^about:[a-z0-9_-]+(?:[?#].*)?$/i.test(raw || '')) return 'internal:about';
    try {
      const url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      let host = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
      if (!host) return null;
      // Google products remain separate websites; most other subdomains share a site.
      if (host === 'mail.google.com') return 'gmail.com';
      if (SEPARATE_HOSTS.has(host)) return host;
      try {
        const base = Services.eTLD.getBaseDomainFromHost(host);
        if (base) host = base;
      } catch (_) { /* localhost/IP/no public suffix */ }
      if (host === 'youtu.be') host = 'youtube.com';
      if (host === 'twitter.com') host = 'x.com';
      return host;
    } catch (_) { return null; }
  }

  function nameFor(site) {
    if (SITE_NAMES[site]) return SITE_NAMES[site];
    const first = site.split('.')[0];
    return first ? first[0].toUpperCase() + first.slice(1) : site;
  }

  function eligible(tab) {
    if (!tab?.isConnected || tab.pinned || tab.hasAttribute('zen-essential') ||
        tab.hasAttribute('zen-empty-tab') || tab.hasAttribute('zen-glance-tab') ||
        tab.closest('tab-group[split-view-group]')) return false;
    return true;
  }

  function openedAt(tab) {
    try {
      const saved = Number(getSessionStore('getCustomTabValue')?.getCustomTabValue(tab, STORE_KEY));
      if (Number.isFinite(saved) && saved > 0) return saved;
    } catch (_) {}
    if (Number.isFinite(tab.__zsfOpenedAt)) return tab.__zsfOpenedAt;
    // Historical tabs have no reliably exposed creation time: retain their
    // current relative order as the initial ordering baseline.
    const fallback = legacyBase + (Number(tab._tPos) || 0);
    tab.__zsfOpenedAt = fallback;
    try { getSessionStore('setCustomTabValue')?.setCustomTabValue(tab, STORE_KEY, String(fallback)); } catch (_) {}
    return fallback;
  }

  function storedOpenedAt(tab) {
    // Read only genuine timestamps. The legacy sort key is a synthetic ordering
    // baseline on old tabs and must never become an apparent opening time.
    for (const store of sessionStores()) {
      try {
        const raw = store?.getCustomTabValue?.(tab, REAL_OPENED_KEY);
        const time = Number(raw);
        if (raw && Number.isFinite(time) && time > 0 && time <= Date.now() + 60_000)
          return time;
      } catch (_) {}
    }
    return null;
  }

  function restoreOpenedAt(tab) {
    if (!tab) return;
    const saved = storedOpenedAt(tab);
    if (saved !== null) tab.__zsfReliableOpenedAt = saved;
    else delete tab.__zsfReliableOpenedAt;
  }

  function persistOpenedAt(tab, stamp) {
    if (!tab || !Number.isFinite(stamp) || stamp <= 0) return;
    tab.__zsfReliableOpenedAt = stamp;
    try { getSessionStore('setCustomTabValue')?.setCustomTabValue(tab, REAL_OPENED_KEY, String(stamp)); }
    catch (_) {} // Keep the in-memory time until SessionStore finishes initialization.
  }

  function reconcileOpenedAt(tab) {
    if (!tab) return;
    const newStamp = newTabOpenedAt.get(tab);
    if (newStamp !== undefined) {
      // Native duplicateTab can copy its source's SessionStore data after
      // TabOpen. The duplicate's new clock takes precedence on tab restoration.
      persistOpenedAt(tab, newStamp);
    } else {
      // Restored or lazily loaded tab: never fabricate a new opening time.
      restoreOpenedAt(tab);
    }
  }

  function noteNewTab(tab) {
    if (!tab) return;
    if (sessionRestoreBusy || startupRestorePending) {
      // Native session restore (including reopen-closed-tab) may emit TabOpen.
      // A restored tab with no real timestamp is historically unknown.
      reconcileOpenedAt(tab);
    } else {
      const stamp = Date.now();
      newTabOpenedAt.set(tab, stamp);
      // Independent of the legacy sort clock, which may have been copied from
      // another tab. Never skip this because __zsfOpenedAt already exists.
      persistOpenedAt(tab, stamp);
    }
    // The sorting clock is separate; preserve it if SessionStore restored it.
    if (tab.__zsfOpenedAt) return;
    try {
      const restored = Number(getSessionStore('getCustomTabValue')?.getCustomTabValue(tab, STORE_KEY));
      if (Number.isFinite(restored) && restored > 0) {
        tab.__zsfOpenedAt = restored;
        return;
      }
    } catch (_) {}
    if (sessionRestoreBusy || startupRestorePending) return;
    const stamp = Date.now() + (++seq / 1000);
    tab.__zsfOpenedAt = stamp;
    try { getSessionStore('setCustomTabValue')?.setCustomTabValue(tab, STORE_KEY, String(stamp)); } catch (_) {}
  }

  function getGroups(node) {
    const groups = [];
    for (const holder of [node.pinnedTabsContainer, node.tabsContainer]) {
      holder?.querySelectorAll('zen-folder, tab-group:not([split-view-group])')
        .forEach(g => {
          if (g.isConnected && !g.hasAttribute('cloned')) groups.push(g);
        });
    }
    return groups;
  }

  // DOM attributes are not guaranteed to survive session restore. Persist
  // ONLY our own group IDs, never infer ownership from another mod's label.
  function readOwnedSites() {
    try {
      const raw = getSessionStore('getCustomWindowValue')?.getCustomWindowValue(window, OWNED_GROUPS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { return {}; }
  }

  function rememberOwnedSite(group, site) {
    if (!group?.id || !site || !getSessionStore('setCustomWindowValue')) return;
    try {
      const owned = readOwnedSites();
      if (owned[group.id] === site) return;
      owned[group.id] = site;
      getSessionStore('setCustomWindowValue').setCustomWindowValue(window, OWNED_GROUPS_KEY, JSON.stringify(owned));
    } catch (error) { console.warn(TAG, 'Could not persist site group ID:', error); }
  }

  function forgetOwnedSite(group) {
    if (!group?.id || !getSessionStore('setCustomWindowValue')) return;
    try {
      const owned = readOwnedSites();
      if (!(group.id in owned)) return;
      delete owned[group.id];
      getSessionStore('setCustomWindowValue').setCustomWindowValue(window, OWNED_GROUPS_KEY, JSON.stringify(owned));
    } catch (error) { console.warn(TAG, 'Could not clear site group ID:', error); }
  }

  function siteOfGroup(group) {
    if (!group?.isConnected || !group.id) return null;
    const site = group.getAttribute('data-zsf-site') || readOwnedSites()[group.id] || null;
    if (site && group.getAttribute('data-zsf-site') !== site) {
      group.setAttribute('data-zsf-site', site);
    }
    return site;
  }


  function sourceFaviconURL(tab) {
    const raw = tabURL(tab);
    if (!raw) return null;
    if (/^about:/i.test(raw)) return 'chrome://global/skin/icons/settings.svg';
    // page-icon resolves through Firefox's own favicon cache, not a third-party API.
    return 'page-icon:' + raw;
  }

  function decorate(group, site, sampleTab) {
    if (!group?.isConnected || !site) return;
    // Only own site groups get our class/appearance. All other Zia folders remain untouched.
    group.setAttribute('data-zsf-site', site);
    rememberOwnedSite(group, site);
    const label = group.querySelector('.tab-group-label-container');
    if (!label) return;
    let icon = label.querySelector(':scope > .' + ICON_CLASS);
    if (!icon) {
      icon = document.createXULElement('image');
      icon.classList.add(ICON_CLASS);
      icon.setAttribute('aria-hidden', 'true');
      const text = label.querySelector('.tab-group-label');
      label.insertBefore(icon, text || label.firstChild);
    }
    const tab = sampleTab || [...group.querySelectorAll('tab')].find(t => siteFor(tabURL(t)) === site);
    const src = tab ? sourceFaviconURL(tab) : null;
    if (src && !group.hasAttribute('data-zsf-custom-icon') && icon.getAttribute('src') !== src) icon.setAttribute('src', src);
    if (src && group.isZenFolder) {
      try { window.gZenFolders?.setFolderUserIcon?.(group, src); }
      catch (e) { console.warn(TAG, 'Native folder favicon error:', e); }
    }
  }

  function reapplyAppearance() {
    const current = workspace();
    if (!current) return;
    for (const group of getGroups(current.node)) {
      const site = siteOfGroup(group);
      if (site) decorate(group, site);
    }
  }

  // Firefox's current documented API moves an element before a target;
  // avoid raw DOM reparenting and the old numeric moveTabTo signature.
  function reorderGroup(group, orderedTabs) {
    const alive = orderedTabs.filter(tab => tab?.isConnected && tab.group === group);
    for (let i = alive.length - 2; i >= 0; i--) {
      const left = alive[i];
      const right = alive[i + 1];
      if (left === right || left.group !== group || right.group !== group ||
          right.previousElementSibling === left) continue;
      try { window.gBrowser.moveTabBefore(left, right); }
      catch (e) { console.warn(TAG, 'Group reorder failed:', e); }
    }
  }

  function sortOwnedGroupNewestFirst(group) {
    if (!group?.isConnected || group.isZenFolder ||
        group.pinned || !siteOfGroup(group) ||
        group.hasAttribute('split-view-group')) return;
    const members = [...(group.tabs || group.querySelectorAll('tab'))]
      .filter(tab => eligible(tab) && tab.group === group && !tab.pinned);
    const order = members.map((tab, index) => ({
      tab, stamp: openedAt(tab), index
    })).sort((a, b) => (b.stamp - a.stamp) || (a.index - b.index));
    reorderGroup(group, order.map(item => item.tab));
  }


  // Standalone tabs always use genuine opening times. The legacy sort key
  // may only represent a synthetic pre-v0.6.9 fallback, so never rank on it.
  function orderStandaloneTabs(tabs) {
    return tabs.map((tab, index) => ({ tab, index, opened: storedOpenedAt(tab) }))
      .sort((a, b) => {
        if (a.opened !== null && b.opened !== null)
          return (b.opened - a.opened) || (a.index - b.index);
        if (a.opened !== null) return -1;
        if (b.opened !== null) return 1;
        return a.index - b.index;
      }).map(entry => entry.tab);
  }

  function standaloneTab(tab, root) {
    return tab?.isConnected && tab.localName === 'tab' &&
      tab.parentElement === root && !tab.group &&
      eligible(tab) && !!siteFor(tabURL(tab));
  }

  function lastOrdinaryGroup(root) {
    return [...(root?.children || [])].reverse().find(node =>
      node?.isConnected && node.parentElement === root &&
      node.localName === 'tab-group' && !node.pinned &&
      !node.hasAttribute('split-view-group')) || null;
  }

  // Explicit organize collects every eligible standalone; close-to-one only
  // sorts the existing tail and the departing tab, leaving manually relocated
  // independent tabs above the group region exactly where the user put them.
  async function arrangeStandaloneTabs({ includeManual = false, incoming = [] } = {}) {
    const current = workspace();
    const root = current?.node?.tabsContainer;
    const browser = window.gBrowser;
    if (!root || !browser || typeof browser.moveTabBefore !== 'function' ||
        typeof browser.moveTabAfter !== 'function')
      throw new Error('獨立分頁排序缺少 Zen 原生 API');
    const nodes = [...root.children];
    const lastGroup = lastOrdinaryGroup(root);
    const lastIndex = lastGroup ? nodes.indexOf(lastGroup) : -1;
    const keep = new Set(incoming.filter(tab => standaloneTab(tab, root)));
    const candidates = nodes.filter((tab, index) =>
      standaloneTab(tab, root) &&
      (includeManual || index > lastIndex || keep.has(tab)));
    if (!candidates.length) return { considered: 0, moved: 0 };
    const desired = orderStandaloneTabs(candidates);
    let moved = 0;
    if (lastGroup) {
      let anchor = lastGroup;
      for (const tab of desired) {
        if (!tab.isConnected || tab.parentElement !== root || tab.group)
          throw new Error('獨立分頁排序期間發生群組變更');
        if (tab.previousElementSibling !== anchor) {
          await browser.moveTabAfter(tab, anchor);
          moved++;
        }
        anchor = tab;
      }
    } else {
      // No groups: preserve the last standalone's placement while ordering
      // the adjacent standalone run; never reparent or clone any tab.
      for (let i = desired.length - 2; i >= 0; i--) {
        const tab = desired[i], next = desired[i + 1];
        if (tab.nextElementSibling !== next) {
          await browser.moveTabBefore(tab, next);
          moved++;
        }
      }
    }
    const visible = [...root.children].filter(tab => desired.includes(tab));
    if (visible.length !== desired.length ||
        visible.some((tab, index) => tab !== desired[index]))
      throw new Error('獨立分頁排序後順序驗證失敗');
    return { considered: desired.length, moved };
  }

  function scrollPositionGuard() {
    const space = workspace();
    const port = space?.node?.scrollbox?.scrollbox || space?.node?.scrollbox;
    const tab = window.gBrowser?.selectedTab;
    if (!port?.getBoundingClientRect || !tab?.getBoundingClientRect ||
        !tab.isConnected || !space?.node?.contains?.(tab)) return () => {};
    const viewport = port.getBoundingClientRect();
    const start = tab.getBoundingClientRect().top;
    if (start < viewport.top || start >= viewport.bottom) return () => {};
    return () => {
      if (!tab.isConnected || window.gBrowser?.selectedTab !== tab) return;
      const delta = tab.getBoundingClientRect().top - start;
      if (Number.isFinite(delta) && Math.abs(delta) > 0.5 &&
          Math.abs(delta) < port.scrollHeight)
        port.scrollTop += delta;
    };
  }

  function isOwnedCloseGroup(group) {
    return group?.isConnected && !group.isZenFolder && !group.pinned &&
      !group.hasAttribute?.('split-view-group') &&
      group.parentElement?.localName !== 'zen-folder' &&
      !!siteOfGroup(group);
  }

  // Zen/Zia can leave a fill:forwards height/opacity animation on the last
  // background member of a collapsed folder. After native ungroup it becomes
  // a standalone tab, but that animation still paints a zero-height row.
  // Cancel ONLY size/fade animations bound to the ungrouped tab itself.
  // Do not touch other groups, native folders, selection or page state.
  function revealDetachedTab(tab) {
    const root = workspace()?.node?.tabsContainer;
    if (!tab?.isConnected || tab.group || tab.pinned ||
        tab.parentElement !== root) return false;
    try {
      for (const animation of tab.getAnimations?.({ subtree: false }) || []) {
        const frames = animation.effect?.getKeyframes?.() || [];
        if (frames.some(frame => 'height' in frame || 'minHeight' in frame ||
            'opacity' in frame)) animation.cancel();
      }
    } catch (error) {
      console.warn(TAG, 'Detached tab animation cleanup failed:', error);
    }
    window.gZenFolders?.styleCleanup?.([tab]);
    // Only a standalone tab in the *active* Space may be revealed. Never
    // expose a hidden tab from another Space or a pinned/Glance tab.
    if (tab.hidden && typeof window.gBrowser?.showTab === 'function')
      window.gBrowser.showTab(tab);
    window.gBrowser?.tabContainer?._invalidateCachedVisibleTabs?.();
    return true;
  }

  function watchDetachedTabVisibility(tab) {
    // First clear the persisted animation synchronously. A native close
    // callback can schedule another fade on the next frame; clear that too,
    // without delaying the removal or causing a second tab move.
    if (!revealDetachedTab(tab)) return;
    const next = () => {
      if (tab?.isConnected && !tab.group) revealDetachedTab(tab);
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        next();
        requestAnimationFrame(next);
      });
    }
    // Zia's close animation can finish after those frames. This is
    // post-move maintenance, not a fixed delay before showing the tab.
    setTimeout(() => {
      if (!tab?.isConnected || tab.group) return;
      const box = tab.getBoundingClientRect?.();
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(tab) : null;
      if (tab.hidden || (box && box.height < 1) ||
          (style && (style.opacity === '0' || style.visibility === 'hidden')))
        revealDetachedTab(tab);
    }, 320);
  }

  async function dissolveSingleMember(group, survivor) {
    if (autoUngrouping || running || !isOwnedCloseGroup(group) ||
        !survivor?.isConnected || survivor.group !== group ||
        [...(group.tabs || [])].filter(tab => tab.isConnected && tab.group === group).length !== 1)
      return false;
    const browser = window.gBrowser;
    const root = group.parentElement;
    if (root !== workspace()?.node?.tabsContainer ||
        typeof browser?.ungroupTab !== 'function' ||
        typeof browser.moveTabBefore !== 'function' ||
        typeof browser.moveTabAfter !== 'function') return false;
    const selected = browser.selectedTab === survivor;
    const wasCollapsed = group.collapsed || group.hasAttribute('collapsed');
    const siblings = [...root.children], pos = siblings.indexOf(group);
    const next = siblings.slice(pos + 1).find(node => node.isConnected &&
      (node.localName === 'tab' || node.localName === 'tab-group'));
    const previous = siblings.slice(0, pos).reverse().find(node => node.isConnected &&
      (node.localName === 'tab' || node.localName === 'tab-group'));
    const restoreView = scrollPositionGuard();
    autoUngrouping = true;
    try {
      await browser.ungroupTab(survivor);
      if (!survivor.isConnected || survivor.group || survivor.pinned)
        throw new Error('剩餘分頁解除群組失敗');
      // Zia / native Zen may leave inactive collapsed row presentation inline.
      survivor.removeAttribute('folder-active');
      survivor.removeAttribute('zia-kept-tab');
      survivor.style?.removeProperty?.('--zen-folder-indent');
      window.gZenFolders?.styleCleanup?.([survivor]);
      if (selected) {
        // Stay at exactly the former group slot, even if later TabSelect fires.
        if (next?.isConnected && next.parentElement === root)
          await browser.moveTabBefore(survivor, next);
        else if (previous?.isConnected && previous.parentElement === root)
          await browser.moveTabAfter(survivor, previous);
      } else {
        await arrangeStandaloneTabs({ incoming: [survivor] });
      }
      if (!selected && wasCollapsed) watchDetachedTabVisibility(survivor);
      restoreView();
      return true;
    } catch (error) {
      console.warn(TAG, 'Auto dissolve single-member site group failed:', error);
      restoreView();
      return false;
    } finally {
      autoUngrouping = false;
    }
  }

  function clearCloseWatch(group) {
    const record = closingSiteGroups.get(group);
    if (!record) return;
    record.observer.disconnect();
    clearTimeout(record.timeout);
    closingSiteGroups.delete(group);
  }

  function checkClosedSiteGroup(group) {
    const record = closingSiteGroups.get(group);
    if (!record || running || autoUngrouping ||
        document.documentElement?.hasAttribute?.('zia-dragging-tab')) return;
    if (!isOwnedCloseGroup(group)) { clearCloseWatch(group); return; }
    // A closing tab can remain connected during Zen's close animation.
    // Wait for its actual DOM departure, never a guessed 200–500ms timer.
    if ([...record.closing].some(tab => tab.isConnected && tab.group === group)) return;
    const survivors = [...(group.tabs || [])].filter(tab =>
      tab.isConnected && tab.group === group && !tab.closing);
    if (survivors.length !== 1) { clearCloseWatch(group); return; }
    clearCloseWatch(group);
    void dissolveSingleMember(group, survivors[0]);
  }

  function onSiteTabClose(event) {
    const tab = event.target;
    if (tab?.localName !== 'tab') return;
    const group = tab.group || tab.closest?.('tab-group');
    if (!isOwnedCloseGroup(group)) return;
    let record = closingSiteGroups.get(group);
    if (!record) {
      const observer = new MutationObserver(() => checkClosedSiteGroup(group));
      observer.observe(group, { childList: true, subtree: true });
      record = { observer, closing: new Set(), timeout: null };
      record.timeout = setTimeout(() => {
        checkClosedSiteGroup(group);
        clearCloseWatch(group); // Do not leave a permanent observer on a stale group.
      }, 2500);
      closingSiteGroups.set(group, record);
    }
    record.closing.add(tab);
    queueMicrotask(() => checkClosedSiteGroup(group));
  }

  // Persist tab identity in Firefox's own SessionStore. The document's tab
  // nodes can be recreated on restart; DOM references cannot serve as backup.
  function tabUID(tab, claimed = null) {
    // Persisted ID is mandatory for undo. Try the Zen window API first.
    const stores = sessionStores().filter(store =>
      typeof store?.getCustomTabValue === 'function' &&
      typeof store?.setCustomTabValue === 'function');
    if (!stores.length) {
      console.warn(TAG, 'SessionStore tab identity API unavailable');
      return null;
    }
    const errors = [];
    for (const store of stores) {
      try {
        const saved = store.getCustomTabValue(tab, TAB_UID_KEY);
        // Native Duplicate Tab can copy our custom SessionStore value.
        // Keep the first captured tab's ID; persist a fresh ID only for the
        // distinct copied tab, before any new snapshot or sorting can occur.
        if (typeof saved === 'string' && saved && !claimed?.has(saved)) return saved;
      } catch (e) { errors.push('read: ' + String(e?.message || e)); }
    }
    const id = 'tab-' + (Services.uuid?.generateUUID?.()?.toString?.() ||
      `${Date.now().toString(36)}-${++uidSeq}`);
    for (const store of stores) {
      try {
        store.setCustomTabValue(tab, TAB_UID_KEY, id);
        if (store.getCustomTabValue(tab, TAB_UID_KEY) === id) return id;
        errors.push('readback mismatch');
      } catch (e) { errors.push('write: ' + String(e?.message || e)); }
    }
    console.warn(TAG, 'Unable to persist tab ID', {
      localName: tab?.localName, connected: tab?.isConnected, errors
    });
    return null;
  }

  function readSnapshots() {
    try {
      const raw = getSessionStore('getCustomWindowValue')?.getCustomWindowValue(window, SNAPSHOT_KEY);
      const parsed = raw && JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { return {}; }
  }

  function writeSnapshots(next) {
    const stores = sessionStores().filter(store =>
      typeof store?.setCustomWindowValue === 'function' &&
      typeof store?.getCustomWindowValue === 'function');
    if (!stores.length) {
      console.warn(TAG, 'Window SessionStore backup unavailable');
      return false;
    }
    const serialized = JSON.stringify(next);
    for (const store of stores) {
      try {
        store.setCustomWindowValue(window, SNAPSHOT_KEY, serialized);
        if (store.getCustomWindowValue(window, SNAPSHOT_KEY) === serialized) return true;
      } catch (e) { console.warn(TAG, 'Window backup failed:', e); }
    }
    return false;
  }

  function captureSnapshot(current) {
    // A failed snapshot must never permit sorting. Report exactly why it failed.
    const reject = (reason) => {
      console.warn(TAG, 'Sort blocked: snapshot is incomplete —', reason);
      throw new Error(reason);
    };
    const root = current.node.tabsContainer;
    if (!root?.children) reject('無法讀取目前 Space 的分頁容器');
    const elements = [];
    const tabs = [];
    const seen = new Set();
    const seenTabs = new Set();
    for (const element of root.children) {
      if (!element?.isConnected) continue;
      const tag = element.localName || element.tagName?.toLowerCase();
      if (tag === 'tab-group' && !element.hasAttribute('split-view-group')) {
        if (!element.id) reject('現有群組沒有可還原的 ID');
        const members = [...element.querySelectorAll('tab')]
          .filter(t => eligible(t) &&
            (t.group === element || t.closest('tab-group') === element));
        const ids = [];
        for (const tab of members) {
          if (seenTabs.has(tab)) reject('同一分頁被重複收錄，沒有移動任何分頁');
          seenTabs.add(tab);
          const id = tabUID(tab, seen);
          if (!id) reject('群組內分頁無法保存識別碼');
          if (seen.has(id)) reject('群組內分頁的識別碼重複');
          seen.add(id);
          ids.push(id);
          tabs.push({ id, group: element.id, pinned: !!tab.pinned, url: tabURL(tab) });
        }
        elements.push({
          type: 'group', id: element.id, label: String(element.label || element.getAttribute('label') || ''),
          color: String(element.color || element.getAttribute('color') || ''),
          collapsed: element.hasAttribute('collapsed'),
          site: siteOfGroup(element), tabs: ids
        });
      } else if (tag === 'tab') {
        if (element.getAttribute('zen-workspace-id') !== current.id) continue;
        // Synthetic empty/Glance/pinned tabs are excluded from sorting and
        // may have no SessionStore identity; do not back them up as movable tabs.
        if (!eligible(element)) continue;
        if (seenTabs.has(element)) reject('同一分頁被重複收錄，沒有移動任何分頁');
        seenTabs.add(element);
        const id = tabUID(element, seen);
        if (!id) reject('一般分頁無法保存識別碼');
        if (seen.has(id)) reject('一般分頁的識別碼重複');
        seen.add(id);
        tabs.push({ id, group: null, pinned: !!element.pinned, url: tabURL(element) });
        elements.push({ type: 'tab', id });
      } else if (tag === 'tab-group' && element.hasAttribute('split-view-group')) {
        // No modified tabs in splits: leave that wrapper untouched.
      }
    }
    // If Zen has a different wrapper, do not run a destructive sort with an
    // incomplete snapshot. Only normal non-pinned/non-split tabs count here.
    const needsBackup = allWorkspaceTabs(current.node, current.id).filter(t =>
      eligible(t) && !t.closest('tab-group[split-view-group]'));
    const missing = needsBackup.filter(t => !seen.has(tabUID(t)));
    if (missing.length) {
      reject('有 ' + missing.length + ' 個分頁無法完整備份；可能位於特殊資料夾');
    }
    if (!elements.length && needsBackup.length) reject('沒有找到可還原的原始分頁順序');
    return { version: 4, workspaceId: current.id, capturedAt: Date.now(), elements, tabs, createdFolders: [] };
  }

  function findTabMap(tabs) {
    const map = new Map();
    // Read existing IDs without assigning new ones during recovery. A newly
    // generated ID cannot match the snapshot and obscures the diagnosis.
    for (const tab of tabs) {
      let id = null;
      for (const store of sessionStores()) {
        try {
          const saved = store?.getCustomTabValue?.(tab, TAB_UID_KEY);
          if (typeof saved === 'string' && saved) { id = saved; break; }
        } catch (_) {}
      }
      if (id && !map.has(id)) map.set(id, tab);
      else if (id) console.warn(TAG, 'Duplicate tab identity during restore', id);
    }
    return map;
  }

  // Match pre-existing custom IDs first. Version 4 can additionally recover
  // exactly one missing tab from exactly one live tab with the identical URL.
  // Never infer matches from site, title, position or duplicate URLs.
  function matchSnapshotTabs(current, snapshot) {
    const all = allWorkspaceTabs(current.node, current.id);
    const existing = findTabMap(all);
    const map = new Map();
    const used = new Set();
    for (const original of snapshot.tabs) {
      const tab = existing.get(original.id);
      if (tab?.isConnected && !used.has(tab)) {
        map.set(original.id, tab);
        used.add(tab);
      }
    }
    let urlMatches = 0;
    if (snapshot.version >= 4) {
      const missing = snapshot.tabs.filter(item => !map.has(item.id));
      const count = new Map();
      for (const item of missing) {
        if (item.url) count.set(item.url, (count.get(item.url) || 0) + 1);
      }
      const live = new Map();
      for (const tab of all) {
        if (used.has(tab)) continue;
        const url = tabURL(tab);
        if (!url) continue;
        if (!live.has(url)) live.set(url, []);
        live.get(url).push(tab);
      }
      for (const item of missing) {
        if (!item.url || count.get(item.url) !== 1) continue;
        const candidates = live.get(item.url) || [];
        if (candidates.length !== 1) continue;
        const tab = candidates[0];
        if (!tab?.isConnected || used.has(tab) || !!tab.pinned !== !!item.pinned) continue;
        // Do not associate a URL opened after capture with a lost old tab.
        let created = 0;
        try {
          for (const store of sessionStores()) {
            created = Number(store?.getCustomTabValue?.(tab, STORE_KEY)) || 0;
            if (created > 0) break;
          }
        } catch (_) {}
        if (!created || created > snapshot.capturedAt) continue;
        map.set(item.id, tab);
        used.add(tab);
        urlMatches++;
      }
    }
    return { map, urlMatches };
  }

  // Native ungroupTab may prepend each member outside the group, reversing
  // visible order. Capture the original top-to-bottom tab objects FIRST and
  // use only Firefox tab-moving APIs after every member is safely ungrouped.
  // Never close, recreate, pin, reload, or rewrite any tab identity.
  async function prepareGroupsForTabMoves(groups) {
    const owned = [...new Set(groups)].filter(group => group?.isConnected &&
      !group.isZenFolder && !group.pinned && siteOfGroup(group));
    if (!owned.length) return true;
    const motion = window.__zsfCollapseV037;
    if (!motion) return true; // No bridge has written native inline states.
    if (typeof motion.prepareToMoveTabs !== 'function') return false;
    return motion.prepareToMoveTabs(owned);
  }

  const ungrouping = new WeakSet();
  async function ungroupInDisplayOrder(group, orderedTabs = null) {
    const failure = { moved: 0, errors: 1, ordered: false };
    if (!group || ungrouping.has(group)) return failure;
    ungrouping.add(group);
    try {
      const drag = window.__zsfDragV037;
      if (drag?.beforeMutation && !await drag.beforeMutation(group)) return failure;
      return await detachInDisplayOrder(group, orderedTabs);
    } finally {
      ungrouping.delete(group);
    }
  }

  async function detachInDisplayOrder(group, expectedTabs) {
    const browser = window.gBrowser;
    // Snapshot actual DOM order only AFTER the accepted drop has settled.
    // A caller's earlier list is an identity guard, never the source of order.
    const list = [...(group?.querySelectorAll?.('tab') || [])]
      .filter(tab => tab.group === group);
    const result = { moved: 0, errors: 0, ordered: false };
    if (!group?.isConnected || group.isZenFolder || !list.length ||
        typeof browser?.ungroupTab !== 'function' ||
        (list.length > 1 && typeof browser?.moveTabBefore !== 'function') ||
        list.some(tab => !eligible(tab) || tab.group !== group) ||
        (expectedTabs && (expectedTabs.length !== list.length ||
          list.some(tab => !expectedTabs.includes(tab))))) {
      result.errors = Math.max(list.length, 1);
      return result;
    }
    if (!await prepareGroupsForTabMoves([group])) {
      result.errors = list.length;
      return result;
    }
    const originalParent = group.parentElement;
    const siblings = [...(originalParent?.children || [])];
    const index = siblings.indexOf(group);
    const movable = node => node?.isConnected &&
      (node.localName === 'tab' || node.localName === 'tab-group') &&
      !node.hasAttribute?.('split-view-group');
    const next = index >= 0 ? siblings.slice(index + 1).find(movable) : null;
    const previous = index >= 0 ? siblings.slice(0, index).reverse().find(movable) : null;
    for (const tab of list) {
      if (!tab?.isConnected || tab.group !== group) {
        result.errors++;
        continue;
      }
      try {
        await browser.ungroupTab(tab);
        if (tab.isConnected && tab.group !== group && !tab.pinned) result.moved++;
        else result.errors++;
      } catch (error) {
        result.errors++;
        console.warn(TAG, 'Ungroup failed:', error);
      }
    }
    if (result.errors) return result;
    try {
      // Keep the whole run at the original group's position if a native
      // sibling anchor survives; otherwise sort the newly ungrouped members
      // against one another. Reverse traversal guarantees A,B,C (not C,B,A).
      if (next?.isConnected && next.parentElement === originalParent) {
        for (const tab of list) await browser.moveTabBefore(tab, next);
      } else if (previous?.isConnected && previous.parentElement === originalParent &&
                 typeof browser.moveTabAfter === 'function') {
        let anchor = previous;
        for (const tab of list) {
          await browser.moveTabAfter(tab, anchor);
          anchor = tab;
        }
      } else {
        for (let i = list.length - 2; i >= 0; i--)
          await browser.moveTabBefore(list[i], list[i + 1]);
      }
    } catch (error) {
      result.errors++;
      console.warn(TAG, 'Post-ungroup order restoration failed:', error);
      return result;
    }
    if (window.__zsfDragV037?.nativeIdle &&
        !await window.__zsfDragV037.nativeIdle(group)) {
      result.errors++;
      return result;
    }
    if (window.__zsfDragV037?.nativeIdle && group.isConnected && !group.tabs.length) {
      // Empty group removal is queued by the native MutationObserver and may
      // outlive its tab animations. Wait for removal before rescue inventory.
      const deadline = Date.now() + 4000;
      while (group.isConnected && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 16));
      if (group.isConnected) { result.errors++; return result; }
    }
    const flat = [...(originalParent?.querySelectorAll?.('tab') || browser.tabs || [])];
    const positions = list.map(tab => flat.indexOf(tab));
    result.ordered = positions.every((n, i) => n >= 0 &&
      (!i || n === positions[i - 1] + 1));
    if (!result.ordered) result.errors++;
    return result;
  }

  // User-invoked escape hatch for v3 snapshots whose custom tab IDs no longer
  // exist. Never closes, recreates, reloads, pins or guesses tab identities.
  // All tabs in this mod's generated ordinary groups are left in their current
  // relative location; full historical order cannot be established from v3.
  // An active window can restore owned site groups with *new* DOM/SessionStore
  // group IDs. Never rely on snapshot.createdFolders alone. Ownership must
  // follow our private prefix, our persisted ownership map or the attribute
  // installed exclusively by this mod; never infer it from a matching title.
  function rescueGroupInventory(current, snapshot) {
    const tabsRoot = current?.node?.tabsContainer;
    const remembered = readOwnedSites();
    const created = new Set((snapshot?.createdFolders || []).filter(id =>
      typeof id === 'string' && id.startsWith('zsf-')));
    const all = new Set([
      ...getGroups(current.node),
      ...(tabsRoot?.querySelectorAll?.('tab-group:not([split-view-group])') || [])
    ]);
    for (const tab of allWorkspaceTabs(current.node, current.id)) {
      if (tab.group?.isConnected) all.add(tab.group);
    }
    const ordinary = [...all].filter(group => group?.isConnected &&
      !group.isZenFolder && !group.hasAttribute?.('split-view-group') &&
      group.parentElement === tabsRoot);
    const owned = ordinary.filter(group => {
      const id = String(group.id || '');
      return created.has(id) || id.startsWith('zsf-') ||
        Boolean(id && remembered[id]) ||
        Boolean(group.getAttribute?.('data-zsf-site'));
    });
    return { ordinary, owned };
  }

  async function rescueSiteGroups() {
    if (running) return;
    if (window.__zsfDragV037?.beforeMutation &&
        !await window.__zsfDragV037.beforeMutation()) {
      toast('分頁仍在移動中，請等待拖放完成後再操作；快照保留', true);
      return;
    }
    if (running) return;
    const current = workspace();
    const stored = readSnapshots();
    const snapshot = current && stored[current.id];
    if (!snapshot || ![3, 4].includes(snapshot.version)) {
      toast('目前沒有可救援的網站整理快照', true);
      return;
    }
    const inventory = rescueGroupInventory(current, snapshot);
    const groups = inventory.owned;
    if (!groups.length) {
      // An unknown ordinary tab group might be a restored owned group whose
      // ID *and* tag have been lost. Fail closed: clearing the snapshot would
      // remove the rescue arrow while that group remains in the sidebar.
      if (inventory.ordinary.length) {
        toast('仍有 ' + inventory.ordinary.length +
          ' 個一般分頁群組無法確認歸屬；拒絕重置，還原箭頭及快照保留。' +
          '請先備份工作階段並用群組右鍵檢查', true);
        return;
      }
      const created = snapshot.createdFolders;
      if (!Array.isArray(created) ||
          !created.every(id => typeof id === 'string' && id.startsWith('zsf-'))) {
        toast('舊快照缺少可信任的群組識別資料；拒絕清除，備份保留', true);
        return;
      }
      // No prompt: the second explicit secondary-click, after a prior safe
      // ungroup or successful absence check, requests final archival.
      // We still archive with readback and recheck every ordinary group
      // before removing the snapshot or the recovery arrow.
      const store = getSessionStore('getCustomWindowValue', 'setCustomWindowValue');
      if (!store) { toast('SessionStore 無法寫入；快照未清除', true); return; }
      let archives = {};
      try {
        const raw = store.getCustomWindowValue(window, ARCHIVED_SNAPSHOTS_KEY);
        archives = raw ? JSON.parse(raw) : {};
        if (!archives || typeof archives !== 'object' ||
            Array.isArray(archives)) throw new Error('invalid archive');
        const history = Array.isArray(archives[current.id]) ? archives[current.id] : [];
        const payload = JSON.stringify({ ...archives, [current.id]: [
          ...history, { archivedAt: Date.now(),
            reason: 'verified-no-ordinary-groups',
            snapshot: JSON.parse(JSON.stringify(snapshot)) }
        ] });
        store.setCustomWindowValue(window, ARCHIVED_SNAPSHOTS_KEY, payload);
        if (store.getCustomWindowValue(window, ARCHIVED_SNAPSHOTS_KEY) !== payload)
          throw new Error('archive readback mismatch');
      } catch (error) {
        console.warn(TAG, 'Cannot safely archive snapshot:', error);
        toast('快照封存失敗；保留還原箭頭與原始快照', true);
        return;
      }
      // Recheck the live sidebar AFTER the confirmation and archive, BEFORE
      // removing the only visible rescue entry point.
      const rechecked = rescueGroupInventory(current, snapshot);
      if (rechecked.ordinary.length || rechecked.owned.length) {
        toast('確認期間又出現分頁群組；拒絕清除快照與還原箭頭', true);
        return;
      }
      const next = { ...stored };
      delete next[current.id];
      if (!writeSnapshots(next)) {
        toast('備份已封存，但解除整理鎖定失敗；保留原快照', true);
        return;
      }
      updateButtons();
      toast('確認沒有殘留群組，已封存舊快照並解除整理鎖定');
      return;
    }

    const candidates = [];
    for (const group of groups) {
      const tabs = [...group.querySelectorAll('tab')].filter(tab =>
        tab.group === group);
      if (tabs.some(tab => !eligible(tab)) ||
          group.parentElement !== current.node.tabsContainer) {
        toast('安全拆分停止：群組含特殊、釘選或跨工作區分頁；未變更任何分頁', true);
        return;
      }
      candidates.push({ group, tabs });
    }
    // This secondary-click is already the explicit safe-ungroup gesture.
    // After all preflight checks pass, do it directly; keep the snapshot and
    // arrow until a later user invocation clears the verified empty state.

    const browser = window.gBrowser;
    if (typeof browser?.ungroupTab !== 'function' ||
        typeof browser?.moveTabBefore !== 'function') {
      toast('Zen 缺少維持解散順序所需的 API；未修改分頁', true);
      return;
    }
    running = true;
    updateButtons();
    let moved = 0, errors = 0;
    try {
      for (const { group, tabs } of candidates) {
        if (!group.isConnected) { errors++; continue; }
        if (tabs.length) {
          const result = await ungroupInDisplayOrder(group, tabs);
          moved += result.moved;
          errors += result.errors;
        }
        // Native Zen normally removes empty tab groups automatically.
        // A leftover empty group is safe to remove ONLY after verifying it
        // contains no live tabs; otherwise leave it and preserve the snapshot.
        if (group.isConnected &&
            ![...group.querySelectorAll('tab')].some(tab => tab.isConnected)) {
          try { browser.removeTabGroup?.(group); }
          catch (error) { console.warn(TAG, 'Empty group cleanup failed:', error); }
        }
      }
      const remaining = rescueGroupInventory(current, snapshot);
      const ownedWithTabs = remaining.owned.reduce((n, group) => n +
        [...group.querySelectorAll('tab')].filter(tab =>
          tab.isConnected && tab.group === group).length, 0);
      if (!errors && !remaining.owned.length && !ownedWithTabs) {
        snapshot.rescueCompleted = true;
        snapshot.rescueAt = Date.now();
        if (!writeSnapshots(stored)) {
          toast('分頁已安全拆分，但無法儲存救援進度；原始快照仍保留', true);
        } else {
          toast('已拆分 ' + moved +
            ' 個分頁，原有上下順序保留。快照與箭頭仍在；請核對後再次雙指點按箭頭確認清除');
        }
      } else {
        toast('已拆分 ' + moved + ' 個分頁；仍有 ' + remaining.owned.length +
          ' 個本工具群組未完成，錯誤 ' + errors +
          '。快照與還原箭頭保留，不會重置', true);
      }
    } finally {
      running = false;
      updateButtons();
      setTimeout(reapplyAppearance, 150);
    }
  }

  function indexGroups(current) {
    const groups = new Map();
    for (const group of getGroups(current.node)) {
      if (!groups.has(group.id)) groups.set(group.id, group);
    }
    return groups;
  }

  // Undo restores only identities in the snapshot. Tabs opened afterwards are
  // not closed or reloaded; closed tabs are never re-opened behind the user's back.
  async function undo() {
    if (running) return;
    if (window.__zsfDragV037?.beforeMutation &&
        !await window.__zsfDragV037.beforeMutation()) {
      toast('分頁仍在移動中，請等待拖放完成後再操作；快照保留', true);
      return;
    }
    if (running) return;
    const current = workspace();
    const stored = readSnapshots();
    const snapshot = current && stored[current.id];
    if (!snapshot) { toast('這個工作區沒有可還原的整理紀錄'); return; }
    if (snapshot.version !== 3 && snapshot.version !== 4) { toast('這份舊版快照不支援自動還原；保留備份', true); return; }
    if (snapshot.rescueCompleted) { toast('已進行安全拆分。核對分頁後，可右鍵還原箭頭清除舊快照', true); return; }
    if (!window.gBrowser?.ungroupTab || !window.gBrowser?.moveTabBefore) {
      toast('Zen 的原生還原 API 不可用，未修改分頁'); return;
    }
    running = true;
    updateButtons();
    let errors = 0;
    let missing = 0;
    try {
      const match = matchSnapshotTabs(current, snapshot);
      const tabMap = match.map;
      // Preserve the snapshot IDs during verification even if v4 matched an
      // orphan by unique URL. Never mint or overwrite IDs while restoring.
      const originalIdForTab = new Map([...tabMap].map(([id, tab]) => [tab, id]));
      missing = snapshot.tabs.filter(x => !tabMap.has(x.id)).length;
      if (missing) {
        console.warn(TAG, 'Restore blocked before modification: missing tab IDs', {
          missing, snapshotTotal: snapshot.tabs.length, found: tabMap.size, urlMatches: match.urlMatches, createdFolders: snapshot.createdFolders?.length || 0
        });
        toast('還原暫停：仍有 ' + missing + ' 個分頁無法辨識。未移動分頁、備份保留；可右鍵還原箭頭執行安全拆分', true);
        return;
      }
      if (!await prepareGroupsForTabMoves([...tabMap.values()].map(tab => tab.group))) {
        toast('還原暫停：分頁的收合狀態尚未清理完成；原快照保留，未移動分頁', true);
        return;
      }
      // v3 modifies only ordinary groups; never unpin or delete a Zen folder.

      // 1) Re-create lost manual groups with their original stable ID, label,
      // colour and members. This also covers groups emptied by sorting.
      const originalGroups = snapshot.elements.filter(item => item.type === 'group');
      let groups = indexGroups(current);
      for (const original of originalGroups) {
        let group = groups.get(original.id);
        if (!group?.isConnected) group = null;
        const desired = original.tabs.map(id => tabMap.get(id)).filter(t => t?.isConnected);
        if (!group && desired.length) {
          try {
            group = window.gBrowser.addTabGroup([desired[0]], {
              id: original.id, label: original.label, color: original.color || undefined,
              insertBefore: desired[0], showCreateUI: false
            });
          } catch (error) { console.warn(TAG, 'Cannot re-create original group:', original, error); errors++; }
        }
        if (!group || !group.isConnected || group.id !== original.id) {
          if (desired.length) errors++;
          continue;
        }
        // Keep surviving original groups' names/colour as captured.
        try { if (group.label !== original.label) group.label = original.label; } catch (_) {}
        try { if (original.color && group.color !== original.color) group.color = original.color; } catch (_) {}
        for (const tab of desired) {
          if (tab.group === group) continue;
          try { window.gBrowser.moveTabToExistingGroup(tab, group); }
          catch (error) { errors++; console.warn(TAG, 'Cannot restore group member:', error); }
        }
        if (original.site) decorate(group, original.site, desired[0]);
        else {
          group.removeAttribute('data-zsf-site');
          forgetOwnedSite(group);
          group.querySelector(':scope > .tab-group-label-container > .' + ICON_CLASS)?.remove();
        }
        reorderGroup(group, desired);
      }
      // Walk the snapshot backward. A native move next to a restored
      // top-level anchor can detach a site tab and position it in one call.
      const root = current.node.tabsContainer;
      groups = indexGroups(current);
      let anchor = null;
      for (let i = snapshot.elements.length - 1; i >= 0; i--) {
        const item = snapshot.elements[i];
        const element = item.type === 'group' ? groups.get(item.id) : tabMap.get(item.id);
        if (!element?.isConnected) continue;
        try {
          const sourceGroup = item.type === 'tab' ? element.group : null;
          if (sourceGroup) {
            const canMoveDirectly = anchor?.parentElement === root &&
              !anchor.pinned && !element.pinned && !element.splitview &&
              sourceGroup.parentElement === root && !sourceGroup.isZenFolder &&
              !sourceGroup.pinned && siteOfGroup(sourceGroup) &&
              window.gZenFolders?.canDropElement?.(element, anchor);
            if (canMoveDirectly) window.gBrowser.moveTabBefore(element, anchor);
            if (element.group) window.gBrowser.ungroupTab(element);
          }
          if (anchor && anchor.previousElementSibling !== element)
            window.gBrowser.moveTabBefore(element, anchor);
        } catch (error) {
          errors++;
          console.warn(TAG, 'Cannot restore top-level order:', error);
        }
        anchor = element;
      }
      // 4) Match collapsed state after moving tabs; some native operations
      // expand groups as they receive tabs.
      for (const item of originalGroups) {
        const group = groups.get(item.id);
        if (!group?.isConnected) continue;
        if (group.collapsed !== !!item.collapsed) group.collapsed = !!item.collapsed;
      }
      // Empty ordinary site groups are removed automatically by Firefox.
      const pendingFolders = 0;

      if (window.__zsfDragV037?.nativeIdle && !await window.__zsfDragV037.nativeIdle()) errors++;
      const invisible = snapshot.tabs.filter(item => {
        const tab = tabMap.get(item.id);
        if (item.group !== null || item.pinned || !tab?.isConnected) return false;
        const style = window.getComputedStyle(tab);
        return tab.hidden || tab.getBoundingClientRect().height <= 0 ||
          Number(style.opacity) <= 0 || style.visibility === 'hidden';
      }).length;
      // 5) Verify original pin status, membership and order before discarding backup.
      const wrong = snapshot.tabs.filter(item => {
        const tab = tabMap.get(item.id);
        if (!tab?.isConnected) return false;
        return (tab.group?.id || null) !== item.group ||
          (!!tab.pinned !== !!item.pinned);
      }).length;
      groups = indexGroups(current);
      const wrongSequence = originalGroups.filter(item => {
        const group = groups.get(item.id);
        if (!group) return item.tabs.some(id => tabMap.has(id));
        const memberIds = new Set(item.tabs);
        const actual = [...group.querySelectorAll('tab')].filter(t => t.group === group)
          .map(t => originalIdForTab.get(t)).filter(id => memberIds.has(id));
        const intended = item.tabs.filter(id => tabMap.has(id));
        return actual.join('|') !== intended.join('|');
      }).length;
      const topLevel = [...(root.children || [])].map(el => {
        const tag = el.localName || el.tagName?.toLowerCase();
        if (tag === 'tab-group') return 'group:' + el.id;
        if (tag === 'tab') {
          const id = originalIdForTab.get(el);
          return id ? 'tab:' + id : null;
        }
        return null;
      });
      const liveOrderIds = new Set(topLevel);
      const intended = snapshot.elements.map(e => e.type + ':' + e.id)
        .filter(id => liveOrderIds.has(id));
      const intendedIds = new Set(intended);
      const actual = topLevel.filter(id => intendedIds.has(id));
      const wrongTopLevel = intended.join('|') !== actual.join('|');
      if (errors || missing || wrong || wrongSequence || wrongTopLevel || pendingFolders || invisible) {
        toast(`部分還原：遺失 ${missing}、分組／釘選不符 ${wrong}、順序不符 ${wrongSequence + Number(wrongTopLevel)}、空資料夾未清除 ${pendingFolders}、不可見分頁 ${invisible}；保留備份`, true);
        console.warn(TAG, 'Undo incomplete', { errors, missing, wrong, wrongSequence, wrongTopLevel, pendingFolders, invisible });
      } else {
        delete stored[current.id];
        if (!writeSnapshots(stored)) {
          toast('分頁已還原，但無法刪除備份；可重新啟動後檢查');
        } else {
          toast(`已還原整理前的 ${snapshot.tabs.length} 個分頁及群組順序`);
        }
      }
    } finally {
      running = false;
      updateButtons();
      setTimeout(reapplyAppearance, 150);
    }
  }

  function ensureWave(separator) {
    let svg = separator?.querySelector?.('.zsf-wave');
    if (svg) return svg;
    if (!separator) return null;
    const NS = 'http://www.w3.org/2000/svg';
    svg = document.createElementNS(NS, 'svg');
    svg.classList.add('zsf-wave');
    svg.setAttribute('viewBox', '0 0 100 12');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.classList.add('zsf-wave-path');
    path.setAttribute('d', 'M0,6 L100,6');
    svg.appendChild(path);
    separator.appendChild(svg);
    return svg;
  }

  function startWave() {
    const separator = workspace()?.node.querySelector('.pinned-tabs-container-separator');
    if (!separator) return;
    const svg = ensureWave(separator);
    const line = separator.querySelector(':scope > toolbarseparator');
    if (!svg || !line) return;
    // Position is recalculated on EVERY animation frame: the Undo button
    // becomes visible after the snapshot is saved, while the wave is running.
    const positionWave = () => {
      const hostRect = separator.getBoundingClientRect();
      const lineRect = line.getBoundingClientRect();
      const controls = [...separator.querySelectorAll('toolbarbutton')].filter(button =>
        !button.hidden && button.getClientRects().length &&
        getComputedStyle(button).display !== 'none'
      );
      const leftGuard = Math.max(lineRect.left,
        ...controls.filter(button => button.getBoundingClientRect().left <= lineRect.left + 12)
          .map(button => button.getBoundingClientRect().right + 12));
      const rightGuard = Math.min(lineRect.right,
        ...controls.filter(button => button.getBoundingClientRect().left > lineRect.left + 12)
          .map(button => button.getBoundingClientRect().left - 12));
      const width = Math.max(0, rightGuard - leftGuard);
      svg.style.setProperty('--zsf-wave-left', Math.max(0, leftGuard - hostRect.left).toFixed(1) + 'px');
      svg.style.setProperty('--zsf-wave-width', width.toFixed(1) + 'px');
      svg.style.visibility = width >= 24 ? 'visible' : 'hidden';
    };
    positionWave();
    separator.classList.add('zsf-is-sorting');
    waveStart = performance.now();
    waveEnding = false;
    const step = now => {
      const svg = separator.querySelector('.zsf-wave');
      const path = svg?.querySelector('.zsf-wave-path');
      if (!path || !separator.isConnected) { waveFrame = null; return; }
      positionWave(); // Undo may have appeared or the separator may have resized.
      const duration = now - waveStart;
      const fadeIn = Math.min(1, duration / 180);
      const fadeOut = waveEnding ? Math.max(0, 1 - (duration - MIN_WAVE_MS) / 260) : 1;
      const amplitude = 2.25 * fadeIn * fadeOut;
      const points = [];
      for (let i = 0; i <= 64; i++) {
        const x = i / 64 * 100;
        const y = 6 + amplitude * Math.sin(x / 100 * Math.PI * 6 - duration * 0.019);
        points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
      }
      path.setAttribute('d', 'M' + points.join(' L'));
      if (waveEnding && duration >= MIN_WAVE_MS + 260) {
        separator.classList.remove('zsf-is-sorting');
        waveFrame = null;
        return;
      }
      waveFrame = requestAnimationFrame(step);
    };
    if (waveFrame != null) cancelAnimationFrame(waveFrame);
    waveFrame = requestAnimationFrame(step);
  }

  function endWave() {
    if (waveFrame == null) return;
    const elapsed = performance.now() - waveStart;
    setTimeout(() => { waveEnding = true; }, Math.max(0, MIN_WAVE_MS - elapsed));
  }

  function updateButtons() {
    // Every Space has its own separator; the undo snapshot is per workspace.
    // Avoid global duplicate IDs, and keep inactive Spaces in sync too.
    const snapshots = readSnapshots();
    for (const node of document.querySelectorAll('zen-workspace')) {
      const separator = node.pinnedTabsContainer?.separatorElement ||
        node.querySelector('.pinned-tabs-container-separator');
      if (!separator) continue;
      const undoButton = separator.querySelector('.zsf-undo-button');
      const sortButton = separator.querySelector('.zsf-sort-button');
      const snapshot = snapshots[node.id];
      if (undoButton) {
        undoButton.hidden = !Boolean(snapshot);
        undoButton.disabled = running;
        undoButton.setAttribute('tooltiptext', snapshot
          ? '左鍵還原｜觸控板雙指點按（右鍵）安全拆分'
          : '還原整理前的分頁順序及群組');
      }
      if (sortButton) sortButton.disabled = running;
    }
  }

  function toast(message, isError = false) {
    const text = String(message);
    (isError ? console.warn : console.log)(TAG, text);
    const container = document.getElementById('zen-toast-container');
    if (!container) { if (isError) window.alert(text); return; }
    let box = container.querySelector('#zsf-notification');
    const reused = !!box;
    if (!box) {
      box = document.createXULElement('hbox');
      box.id = 'zsf-notification';
      box.classList.add('zen-toast');
      const inner = document.createXULElement('vbox');
      const label = document.createXULElement('label');
      label.classList.add('zsf-notification-text');
      inner.appendChild(label);
      box.appendChild(inner);
    }
    box.querySelector('.zsf-notification-text').setAttribute('value', text);
    box.setAttribute('tooltiptext', text);
    box.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    container.appendChild(box);
    container.removeAttribute('hidden');
    if (noticeTimer) clearTimeout(noticeTimer);
    const serial = ++noticeSerial;
    const motion = window.gZenUIManager?.motion;
    const play = async (frames, options, fallback, duration) => {
      if (typeof motion?.animate === 'function') {
        try { await motion.animate(box, frames, options); return; }
        catch (e) { console.warn(TAG, 'Zen toast animation fallback:', e); }
      }
      try {
        if (typeof box.animate === 'function') {
          await box.animate(fallback, {
            duration, easing: 'ease-out', fill: 'forwards'
          }).finished;
        }
      } catch (_) {}
    };
    const animateToast = async () => {
      box.style.opacity = '1';
      if (!reused) box.style.transform = 'scale(0)';
      await play({ scale: 1 },
        { type: 'spring', bounce: .2, duration: .5, reduceMotion: false },
        [{ opacity: 0, transform: 'scale(.75)' },
         { opacity: 1, transform: 'scale(1)' }], 300);
      if (serial !== noticeSerial || !box.isConnected) return;
      noticeTimer = setTimeout(async () => {
        if (serial !== noticeSerial || !box.isConnected) return;
        await play({ opacity: [1, 0], scale: [1, .5] },
          { duration: .2, bounce: 0, reduceMotion: false },
          [{ opacity: 1, transform: 'scale(1)' },
           { opacity: 0, transform: 'scale(.5)' }], 200);
        if (serial !== noticeSerial) return;
        box.remove();
        if (!container.querySelector(':scope > .zen-toast')) {
          container.setAttribute('hidden', 'true');
        }
        noticeTimer = null;
      }, 2000);
    };
    void animateToast().catch(e => console.warn(TAG, 'Toast animation failed:', e));
  }

  async function organize() {
    if (running) return;
    if (window.__zsfDragV037?.beforeMutation &&
        !await window.__zsfDragV037.beforeMutation()) {
      toast('分頁仍在移動中，請等待拖放完成後再操作；快照保留', true);
      return;
    }
    if (running) return;
    const current = workspace();
    if (!current) { toast('無法取得目前 Zen Space', true); return; }
    running = true;
    try { startWave(); } catch (e) { console.warn(TAG, 'Wave unavailable:', e); }
    updateButtons();
    try {
      const browser = window.gBrowser;
      // Only create Firefox's unpinned ordinary tab groups.
      const required = ['moveTabToExistingGroup', 'ungroupTab', 'addTabGroup', 'moveTabBefore'];
      const absent = required.filter(name => typeof browser?.[name] !== 'function');
      if (absent.length) throw new Error('缺少還原 API：' + absent.join('、'));
      const stored = readSnapshots();
      if (stored[current.id] && stored[current.id].version !== 4) {
        throw new Error('仍有舊版快照；為保護分頁已拒絕整理，請先備份並處理舊版工作階段');
      }
      // Each explicit organize gets its OWN restore point. Archive the prior
      // snapshot first so old recovery data is not destroyed by the new one.
      const snapshot = captureSnapshot(current);
      const previous = stored[current.id];
      if (previous) {
        const store = getSessionStore('getCustomWindowValue', 'setCustomWindowValue');
        if (!store) throw new Error('歷史整理快照無法封存');
        const raw = store.getCustomWindowValue(window, ARCHIVED_SNAPSHOTS_KEY);
        const archives = raw ? JSON.parse(raw) : {};
        if (!archives || typeof archives !== 'object' || Array.isArray(archives))
          throw new Error('歷史快照格式錯誤；未變更分頁');
        const history = Array.isArray(archives[current.id]) ? archives[current.id] : [];
        const value = JSON.stringify({ ...archives, [current.id]: [
          ...history, { archivedAt: Date.now(),
            reason: 'superseded-by-explicit-organize',
            snapshot: previous }
        ] });
        store.setCustomWindowValue(window, ARCHIVED_SNAPSHOTS_KEY, value);
        if (store.getCustomWindowValue(window, ARCHIVED_SNAPSHOTS_KEY) !== value)
          throw new Error('舊快照封存驗證失敗；未變更分頁');
      }
      if (!writeSnapshots({ ...stored, [current.id]: snapshot }))
        throw new Error('本次整理快照寫入失敗，沒有移動任何分頁');
      const folders = new Map();
      for (const group of getGroups(current.node)) {
        if (group.isZenFolder || group.pinned || group.parentElement !== current.node.tabsContainer) continue;
        const site = siteOfGroup(group);
        if (site && !folders.has(site)) folders.set(site, group);
      }
      const buckets = new Map();
      for (const tab of allWorkspaceTabs(current.node, current.id)) {
        if (!eligible(tab) || tab.closest('zen-folder')) continue;
        const owner = tab.group;
        if (owner && (!siteOfGroup(owner) || owner.parentElement !== current.node.tabsContainer)) continue;
        const site = siteFor(tabURL(tab));
        if (!site || (owner && folders.has(site))) continue;
        if (!buckets.has(site)) buckets.set(site, []);
        buckets.get(site).push({ tab, order: openedAt(tab) });
      }
      // A site with exactly one eligible tab does not justify a new group.
      // One arrival to an existing matching group is still eligible.
      for (const [site, items] of buckets) {
        if (!folders.has(site) && items.length < 2) buckets.delete(site);
      }
      const requested = [...buckets.values()].reduce((sum, items) => sum + items.length, 0);
      let completed = 0, errors = 0, newFolders = 0;
      for (const [site, items] of buckets) {
        // Sort newest to oldest. Legacy tabs without timestamps use their
        // recorded original tab position as a stable approximate baseline.
        items.sort((a, b) => b.order - a.order);
        let folder = folders.get(site);
        try {
          if (!folder) {
            // Persist the planned folder ID BEFORE creating any node.
            // A crash/partial sort must not leave an untracked owned folder.
            const saved = readSnapshots();
            const snapshot = saved[current.id];
            if (!snapshot || snapshot.version !== 4) throw new Error('快照已遺失');
            const id = 'zsf-' + String(Services.uuid.generateUUID()).replace(/[{}]/g, '');
            snapshot.createdFolders.push(id);
            if (!writeSnapshots(saved)) throw new Error('資料夾 ID 無法保存');
            const first = items[0]?.tab;
            if (!first?.isConnected || first.pinned) throw new Error('來源分頁不適合建立群組');
            if (first.group) browser.ungroupTab(first);
            if (first.group || first.parentElement !== current.node.tabsContainer)
              throw new Error('無法從來源群組安全移出分頁');
            folder = browser.addTabGroup([first], {
              id, label: nameFor(site), color: 'grey',
              insertBefore: first, showCreateUI: false
            });
            newFolders++;
          }
          if (!folder || folder.isZenFolder || !folder.isConnected ||
              folder.parentElement !== current.node.tabsContainer) {
            throw new Error('沒有建立出一般分頁群組');
          }
          // The incoming batch is not the entire folder. Preserve existing
          // members (including deliberate cross-site manual placements) in
          // their current order, then insert newly organized tabs above them.
          // Sorting only `items` leaves arrivals below the old members.
          const incoming = new Set(items.map(item => item.tab));
          const preserved = [...(folder.tabs || folder.querySelectorAll('tab'))]
            .filter(tab => eligible(tab) && tab.group === folder &&
              !tab.pinned && !incoming.has(tab));
          for (const {tab} of items) {
            if (!tab.isConnected) { errors++; continue; }
            try {
              if (tab.pinned) throw new Error('拒絕移動釘選分頁');
              if (tab.group !== folder) browser.moveTabToExistingGroup(tab, folder);
              if (tab.group === folder && !tab.pinned && folder.parentElement === current.node.tabsContainer) completed++;
              else errors++;
            } catch (e) {
              errors++;
              console.warn(TAG, 'Moving tab to ordinary site group failed:', site, e);
            }
          }
          // Only reorder tabs already verified as members of this ordinary
          // unpinned group. moveTabBefore preserves the group's position in
          // the normal workspace and never pins any member.
          const sorted = items.map(item => item.tab).filter(tab =>
            tab?.isConnected && tab.group === folder && !tab.pinned);
          const desired = [...sorted, ...preserved.filter(tab =>
            tab.isConnected && tab.group === folder && !tab.pinned)];
          reorderGroup(folder, desired);
          const expected = new Set(desired);
          const visibleOrder = [...folder.querySelectorAll('tab')].filter(tab =>
            expected.has(tab) && tab.group === folder);
          if (visibleOrder.length !== desired.length ||
              visibleOrder.some((tab, index) => tab !== desired[index])) {
            errors++;
            console.warn(TAG, 'Newest-first order verification failed', site);
          }
          if (!folders.has(site)) {
            decorate(folder, site, items[0]?.tab);
            folder.collapsed = true;
          }
        } catch (e) {
          errors++;
          console.warn(TAG, 'Ordinary site group creation failed:', site, e);
        }
      }
      let arranged = { considered: 0, moved: 0 };
      try {
        arranged = await arrangeStandaloneTabs({ includeManual: true });
      } catch (error) {
        errors++;
        console.warn(TAG, 'Independent tab arrangement failed:', error);
      }
      if (completed !== requested || errors) {
        toast('整理不完整：' + completed + '/' + requested +
          ' 個分頁已入資料夾，錯誤 ' + errors + '，可按還原', true);
        console.warn(TAG, 'Ordinary group sort incomplete', { requested, completed, errors });
      } else {
        toast('已整理 ' + completed + ' 個分頁，新增 ' + newFolders +
          ' 個群組；獨立分頁 ' + arranged.considered + ' 個');
      }
    } catch (e) {
      console.error(TAG, 'Sort stopped:', e);
      toast('整理停止：' + String(e?.message || e), true);
    } finally {
      running = false;
      endWave();
      updateButtons();
      setTimeout(reapplyAppearance, 250);
    }
  }

  // A macOS secondary click produces a mousedown followed by contextmenu.
  // Start rescue ONLY after the contextmenu has been consumed. Starting a
  // native confirm dialog inside mousedown lets the later contextmenu escape
  // to the underlying webpage after the dialog is dismissed.
  let lastSecondaryUndo = 0;
  let pendingUndoSecondary = 0;
  let scheduledUndoRescue = null;
  function onUndoSecondaryClick(event) {
    if (event.type === 'mousedown') {
      if (event.button !== 2) return;
      const path = typeof event.composedPath === 'function' ?
        event.composedPath() : [event.target];
      const undoButton = path.find(node => node?.classList?.contains?.('zsf-undo-button'));
      pendingUndoSecondary = undoButton && !undoButton.hidden &&
        !undoButton.disabled && undoButton.isConnected ? Date.now() : 0;
      return;
    }
    if (event.type !== 'contextmenu') return;
    const path = typeof event.composedPath === 'function' ?
      event.composedPath() : [event.target];
    const button = path.find(node => node?.classList?.contains?.('zsf-undo-button'));
    const fromUndo = button && !button.hidden && !button.disabled && button.isConnected;
    const fromRecentUndo = pendingUndoSecondary > 0 &&
      Date.now() - pendingUndoSecondary < 650;
    if (!fromUndo && !fromRecentUndo) return;
    pendingUndoSecondary = 0;
    // Suppress the native/right-click page menu BEFORE opening a modal.
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    const now = Date.now();
    if (now - lastSecondaryUndo < 650) return;
    const current = workspace();
    const snapshot = current && readSnapshots()[current.id];
    if (!snapshot) return;
    lastSecondaryUndo = now;
    if (scheduledUndoRescue != null) clearTimeout(scheduledUndoRescue);
    // Run after this contextmenu dispatch, never from mousedown.
    scheduledUndoRescue = setTimeout(() => {
      scheduledUndoRescue = null;
      rescueSiteGroups().catch(error => {
        console.error(TAG, 'Secondary-click rescue failed:', error);
        toast('安全拆分操作失敗，快照保留', true);
      });
    }, 0);
  }

  function addButton() {
    // Zen creates one native pinned-tabs separator per Space. Install into
    // all of them, not just the one that happened to be active at startup.
    // The native toolbarseparator already has flex=1, keeping Clear at right.
    for (const node of document.querySelectorAll('zen-workspace')) {
      const separator = node.pinnedTabsContainer?.separatorElement ||
        node.querySelector('.pinned-tabs-container-separator');
      if (!separator || separator.closest('.zen-library-spaces, zen-library')) continue;
      const line = separator.querySelector(':scope > toolbarseparator');
      if (!line) continue;

      let sortButton = separator.querySelector('.zsf-sort-button');
      if (!sortButton) {
        sortButton = document.createXULElement('toolbarbutton');
        sortButton.classList.add('zsf-sort-button');
        sortButton.setAttribute('tooltiptext', '依網站整理分頁（整理前會保存還原快照）');
        sortButton.setAttribute('aria-label', '依網站整理分頁');
        sortButton.addEventListener('command', () => organize().catch(e => console.error(TAG, e)));
        separator.insertBefore(sortButton, line);
      }

      let undoButton = separator.querySelector('.zsf-undo-button');
      if (!undoButton) {
        undoButton = document.createXULElement('toolbarbutton');
        undoButton.classList.add('zsf-undo-button');
        undoButton.setAttribute('tooltiptext', '左鍵還原｜雙指點按（右鍵）安全拆分');
        undoButton.setAttribute('aria-label', '還原整理前的分頁');
        undoButton.addEventListener('command', event => {
          // Right-click must never fall through into the normal undo action.
          if (event.button === 2 || Date.now() - lastSecondaryUndo < 650) return;
          undo().catch(e => console.error(TAG, e));
        });
        separator.insertBefore(undoButton, line);
      }

      // Remove the experimental third control left by a prior live update.
      // Only the folder icon and the undo arrow should remain visible.
      separator.querySelector('.zsf-rescue-button')?.remove();

      // Remove the v0.1.4 extra spacer if a live-reload preserved it.
      // Zen's own toolbarseparator already expands to fill remaining space.
      separator.querySelector(':scope > .zsf-sort-spacer')?.remove();
      ensureWave(separator);
    }
    updateButtons();
  }

  function initialize() {
    if (!window.gBrowser?.tabContainer || !window.gZenWorkspaces ||
        !document.querySelector('zen-workspace .pinned-tabs-container-separator')) {
      initTimer = setTimeout(initialize, 1000);
      return;
    }
    // Catch both in-progress and already-finished Zen workspace restoration.
    watchWorkspaceInitialization();
    // Use capture at the browser window: contextmenu on XUL toolbarbuttons
    // can be consumed by native Zen/Zia handlers before a target listener.
    window.addEventListener('mousedown', onUndoSecondaryClick, true);
    window.addEventListener('contextmenu', onUndoSecondaryClick, true);
    addButton();
    reapplyAppearance();
    // SessionStore may restore group elements after window load.
    setTimeout(reapplyAppearance, 800);
    setTimeout(reapplyAppearance, 2500);
    // SSWindowStateBusy/Ready brackets native session restores, including
    // reopen-closed-tab. Opening one must never reset or invent an age.
    window.addEventListener('SSWindowStateBusy', () => { sessionRestoreBusy = true; });
    window.addEventListener('SSWindowStateReady', () => { sessionRestoreBusy = false; });
    window.gBrowser.tabContainer.addEventListener('SSTabRestoring', e => reconcileOpenedAt(e.target));
    window.gBrowser.tabContainer.addEventListener('SSTabRestored', e => reconcileOpenedAt(e.target));
    // Only a close, not a drag-out or TabUngrouped event, triggers the
    // single-member automatic dissolution.
    window.gBrowser.tabContainer.addEventListener('TabClose', onSiteTabClose, true);
    window.gBrowser.tabContainer.addEventListener('TabOpen', e => {
      noteNewTab(e.target);
      // Automatic grouping is intentionally disabled in the Zia-compatible
      // build. Group creation/moves must happen only from the explicit button.
      // This prevents competing re-entrant sorts during Zia folder animations.
    });
    // Zen updates the Space list with this event. Normal switching doesn't
    // necessarily emit it, but every existing Space already has its controls.
    window.addEventListener('ZenWorkspacesUIUpdate', () => {
      setTimeout(() => { addButton(); reapplyAppearance(); }, 50);
    });
    window.addEventListener('AfterWorkspacesSessionRestore', () => {
      setTimeout(() => { addButton(); reapplyAppearance(); }, 50);
    });
    window.gBrowser.tabContainer.addEventListener('TabGroupCreate', () => setTimeout(reapplyAppearance, 200));
    // Do not automatically re-sort when native Zen emits TabGrouped.
    // During a manual in-folder drag, Zen may emit TabGrouped as it moves
    // the tab. The former 80ms newest-first pass undid the user's chosen
    // position, making some tabs appear impossible to reorder.
    // Explicit 'organize' still applies newest-first once, and afterwards
    // the user's manual order always takes precedence.
    window.__zenSiteFoldersV037 = { organize, undo, rescueSiteGroups, ungroupInDisplayOrder, reapplyAppearance, readSnapshots, version: '0.7.4' };
    console.info?.(TAG, '0.7.4 runtime-ready', JSON.stringify({ motion: window.__zsfCollapseV037?.revision, topDrop: !!window.__zsfTopDrop }));
  }

  if (document.readyState === 'complete') initialize();
  else window.addEventListener('load', initialize, { once: true });
  window.addEventListener('unload', () => {
    window.removeEventListener('mousedown', onUndoSecondaryClick, true);
    window.removeEventListener('contextmenu', onUndoSecondaryClick, true);
    clearTimeout(initTimer);
    if (scheduledUndoRescue != null) clearTimeout(scheduledUndoRescue);
    if (waveFrame != null) cancelAnimationFrame(waveFrame);
    if (noticeTimer) clearTimeout(noticeTimer);
    window.gBrowser?.tabContainer?.removeEventListener('TabClose', onSiteTabClose, true);
    for (const group of closingSiteGroups.keys()) clearCloseWatch(group);
    noticeSerial++;
  }, { once: true });
})();
