// ==UserScript==
// @name         Zen Site Folders
// @version      0.3.6
// @description  Group all normal tabs by website and show locally cached favicons.
// @include      chrome://browser/content/browser.xhtml
// ==/UserScript==
(() => {
  'use strict';
  if (window.__zenSiteFoldersV036) return;
  window.__zenSiteFoldersV036 = true;

  const TAG = '[ZenSiteFolders]';
  const STORE_KEY = 'zsf-created-at-v1';
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

  function noteNewTab(tab) {
    if (!tab || tab.__zsfOpenedAt) return;
    // During session restore, do not overwrite the original creation stamp.
    try {
      const restored = Number(getSessionStore('getCustomTabValue')?.getCustomTabValue(tab, STORE_KEY));
      if (Number.isFinite(restored) && restored > 0) {
        tab.__zsfOpenedAt = restored;
        return;
      }
    } catch (_) {}
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

  function findGroup(node, site) {
    // Only native Zen folders are valid new site-folder destinations.
    return getGroups(node).find(g => !g.isZenFolder && siteOfGroup(g) === site && g.parentElement === node.tabsContainer) || null;
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
      if (left === right || left.group !== group || right.group !== group) continue;
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

  // Persist tab identity in Firefox's own SessionStore. The document's tab
  // nodes can be recreated on restart; DOM references cannot serve as backup.
  function tabUID(tab) {
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
        if (typeof saved === 'string' && saved) return saved;
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
          const id = tabUID(tab);
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
        const id = tabUID(element);
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

  function findTabMap(current) {
    const map = new Map();
    // Read existing IDs without assigning new ones during recovery. A newly
    // generated ID cannot match the snapshot and obscures the diagnosis.
    const tabs = allWorkspaceTabs(current.node, current.id);
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
    const existing = findTabMap(current);
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
  function ungroupInDisplayOrder(group, orderedTabs = null) {
    const browser = window.gBrowser;
    const list = orderedTabs || [...(group?.querySelectorAll?.('tab') || [])]
      .filter(tab => tab.group === group);
    const result = { moved: 0, errors: 0, ordered: false };
    if (!group?.isConnected || group.isZenFolder || !list.length ||
        typeof browser?.ungroupTab !== 'function' ||
        (list.length > 1 && typeof browser?.moveTabBefore !== 'function') ||
        list.some(tab => !eligible(tab) || tab.group !== group)) {
      result.errors = Math.max(list.length, 1);
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
        browser.ungroupTab(tab);
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
        for (const tab of list) browser.moveTabBefore(tab, next);
      } else if (previous?.isConnected && previous.parentElement === originalParent &&
                 typeof browser.moveTabAfter === 'function') {
        let anchor = previous;
        for (const tab of list) {
          browser.moveTabAfter(tab, anchor);
          anchor = tab;
        }
      } else {
        for (let i = list.length - 2; i >= 0; i--)
          browser.moveTabBefore(list[i], list[i + 1]);
      }
    } catch (error) {
      result.errors++;
      console.warn(TAG, 'Post-ungroup order restoration failed:', error);
      return result;
    }
    const current = workspace();
    const flat = current ? allWorkspaceTabs(current.node, current.id) :
      [...(browser.tabs || [])];
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
  function confirmRescue(message) {
    try {
      if (typeof Services.prompt?.confirm === 'function') {
        return Services.prompt.confirm(window, 'Zen Site Folders', message);
      }
    } catch (error) {
      console.warn(TAG, 'Native confirmation unavailable:', error);
    }
    try {
      return typeof window.confirm === 'function'
        ? window.confirm(message) : false;
    } catch (error) {
      console.warn(TAG, 'Confirmation failed; rescue cancelled:', error);
      toast('無法開啟安全拆分確認視窗；沒有移動任何分頁', true);
      return false;
    }
  }

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
      const visible = allWorkspaceTabs(current.node, current.id).filter(tab =>
        tab?.isConnected && !tab.hasAttribute('cloned')).length;
      if (!confirmRescue('目前已找不到由本工具建立的任何網站群組，也沒有其他一般群組待確認。\n' +
        '可辨識 ' + visible + ' 個分頁；舊快照包含 ' + snapshot.tabs.length +
        ' 個。此操作不會移動或關閉分頁。\n' +
        '確定將舊快照完整封存，再清除整理鎖定與還原箭頭嗎？')) return;
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
    const count = candidates.reduce((n, entry) => n + entry.tabs.length, 0);
    if (!confirmRescue('安全拆分將解除目前辨識為本工具建立的 ' + groups.length +
      ' 個網站群組，保留其中 ' + count + ' 個分頁。\n' +
      '即使 Zen 恢復工作階段後改變群組 ID，也會依可信任的擁有權標記辨識。\n' +
      '分頁維持原本在資料夾內由上到下的順序；不會關閉或重新載入網頁。\n' +
      '拆分後先保留快照與還原箭頭，供你核對。確定嗎？')) return;

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
          const result = ungroupInDisplayOrder(group, tabs);
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

  function findGroupByID(current, id) {
    return getGroups(current.node).find(g => g.id === id) || null;
  }

  // Undo restores only identities in the snapshot. Tabs opened afterwards are
  // not closed or reloaded; closed tabs are never re-opened behind the user's back.
  async function undo() {
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
      // v3 modifies only ordinary groups; never unpin or delete a Zen folder.

      // 1) Re-create lost manual groups with their original stable ID, label,
      // colour and members. This also covers groups emptied by sorting.
      for (const original of snapshot.elements.filter(x => x.type === 'group')) {
        let group = findGroupByID(current, original.id);
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
      // 2) Put formerly standalone tabs back outside any created site group.
      for (const item of snapshot.tabs.filter(x => x.group === null)) {
        const tab = tabMap.get(item.id);
        if (tab?.isConnected && tab.group) {
          try { window.gBrowser.ungroupTab(tab); }
          catch (error) { errors++; console.warn(TAG, 'Cannot ungroup original tab:', error); }
        }
      }
      // 3) Original top-level order (including groups) is restored by native
      // element moves, not by touching browser session DOM directly.
      const activeElements = snapshot.elements.map(item => item.type === 'group'
        ? findGroupByID(current, item.id) : tabMap.get(item.id))
        .filter(el => el?.isConnected);
      for (let i = activeElements.length - 2; i >= 0; i--) {
        try { window.gBrowser.moveTabBefore(activeElements[i], activeElements[i + 1]); }
        catch (error) { errors++; console.warn(TAG, 'Cannot restore top-level order:', error); }
      }
      // 4) Match collapsed state after moving tabs; some native operations
      // expand groups as they receive tabs.
      for (const item of snapshot.elements.filter(x => x.type === 'group')) {
        const group = findGroupByID(current, item.id);
        if (!group) continue;
        if (item.collapsed) group.setAttribute('collapsed', 'true');
        else group.removeAttribute('collapsed');
      }
      // Empty ordinary site groups are removed automatically by Firefox.
      const pendingFolders = 0;

      // 5) Verify original pin status, membership and order before discarding backup.
      const wrong = snapshot.tabs.filter(item => {
        const tab = tabMap.get(item.id);
        if (!tab?.isConnected) return false;
        return (tab.group?.id || null) !== item.group ||
          (!!tab.pinned !== !!item.pinned);
      }).length;
      const wrongSequence = snapshot.elements.filter(item => {
        if (item.type !== 'group') return false;
        const group = findGroupByID(current, item.id);
        if (!group) return item.tabs.some(id => tabMap.has(id));
        const actual = [...group.querySelectorAll('tab')].filter(t => t.group === group)
          .map(t => originalIdForTab.get(t)).filter(id => item.tabs.includes(id));
        const intended = item.tabs.filter(id => tabMap.has(id));
        return actual.join('|') !== intended.join('|');
      }).length;
      const root = current.node.tabsContainer;
      const topLevel = [...(root.children || [])].map(el => {
        const tag = el.localName || el.tagName?.toLowerCase();
        if (tag === 'tab-group') return 'group:' + el.id;
        if (tag === 'tab') {
          const id = originalIdForTab.get(el);
          return id ? 'tab:' + id : null;
        }
        return null;
      });
      const intended = snapshot.elements.map(e => e.type + ':' + e.id)
        .filter(id => topLevel.includes(id));
      const actual = topLevel.filter(id => intended.includes(id));
      const wrongTopLevel = intended.join('|') !== actual.join('|');
      if (errors || missing || wrong || wrongSequence || wrongTopLevel || pendingFolders) {
        toast(`部分還原：遺失 ${missing}、分組／釘選不符 ${wrong}、順序不符 ${wrongSequence + Number(wrongTopLevel)}、空資料夾未清除 ${pendingFolders}；保留備份`, true);
        console.warn(TAG, 'Undo incomplete', { errors, missing, wrong, wrongSequence, wrongTopLevel, pendingFolders });
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
      if (!stored[current.id]) {
        const snapshot = captureSnapshot(current);
        if (!snapshot || !writeSnapshots({ ...stored, [current.id]: snapshot })) {
          throw new Error('整理前備份寫入失敗，沒有移動任何分頁');
        }
      }
      const buckets = new Map();
      for (const tab of allWorkspaceTabs(current.node, current.id)) {
        if (!eligible(tab) || (tab.group && !siteOfGroup(tab.group))) continue;
        if (tab.pinned || tab.closest('zen-folder')) continue;
        const site = siteFor(tabURL(tab));
        if (!site) continue;
        if (!buckets.has(site)) buckets.set(site, []);
        buckets.get(site).push({ tab, order: openedAt(tab) });
      }
      const requested = [...buckets.values()].reduce((sum, items) => sum + items.length, 0);
      let completed = 0, errors = 0, newFolders = 0;
      for (const [site, items] of buckets) {
        // Sort newest to oldest. Legacy tabs without timestamps use their
        // recorded original tab position as a stable approximate baseline.
        items.sort((a, b) => b.order - a.order);
        let folder = findGroup(current.node, site);
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
            if (!first?.isConnected || first.pinned || first.group) throw new Error('來源分頁不適合建立群組');
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
          reorderGroup(folder, sorted);
          const visibleOrder = [...folder.querySelectorAll('tab')].filter(tab =>
            sorted.includes(tab) && tab.group === folder);
          if (visibleOrder.length !== sorted.length ||
              visibleOrder.some((tab, index) => tab !== sorted[index])) {
            errors++;
            console.warn(TAG, 'Newest-first order verification failed', site);
          }
          decorate(folder, site, items[0]?.tab);
          try { folder.collapsed = true; } catch (_) {}
        } catch (e) {
          errors++;
          console.warn(TAG, 'Ordinary site group creation failed:', site, e);
        }
      }
      if (!requested) {
        toast('目前沒有新增的一般網站分頁需要整理');
      } else if (completed !== requested || errors) {
        toast(`整理不完整：${completed}/${requested} 個分頁已入資料夾，可按還原`, true);
        console.warn(TAG, 'Ordinary group sort incomplete', { requested, completed, errors });
      } else {
        toast(`已整理 ${completed} 個分頁，新增 ${newFolders} 個一般分頁群組`);
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
    // Use capture at the browser window: contextmenu on XUL toolbarbuttons
    // can be consumed by native Zen/Zia handlers before a target listener.
    window.addEventListener('mousedown', onUndoSecondaryClick, true);
    window.addEventListener('contextmenu', onUndoSecondaryClick, true);
    addButton();
    reapplyAppearance();
    // SessionStore may restore group elements after window load.
    setTimeout(reapplyAppearance, 800);
    setTimeout(reapplyAppearance, 2500);
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
    // Zen emits TabGrouped with the tab in event.detail. Sort only this
    // mod's ordinary unpinned group after an explicit user grouping action;
    // never auto-group or continuously override manual drag ordering.
    window.addEventListener('TabGrouped', event => {
      const tab = event?.detail;
      const group = tab?.group;
      if (running || !group?.isConnected || !siteOfGroup(group) ||
          group.isZenFolder || group.pinned) return;
      setTimeout(() => {
        if (!running && tab?.isConnected && tab.group === group)
          sortOwnedGroupNewestFirst(group);
      }, 80);
    });
    window.__zenSiteFoldersV036 = { organize, undo, rescueSiteGroups, ungroupInDisplayOrder, reapplyAppearance, readSnapshots };
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
    noticeSerial++;
  }, { once: true });
})();