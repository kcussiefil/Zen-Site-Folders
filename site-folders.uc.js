// ==UserScript==
// @name         Zen Site Folders
// @version      0.2.5
// @description  Group all normal tabs by website and show locally cached favicons.
// @include      chrome://browser/content/browser.xhtml
// ==/UserScript==
(() => {
  'use strict';
  if (window.__zenSiteFoldersV025) return;
  window.__zenSiteFoldersV025 = true;

  const TAG = '[ZenSiteFolders]';
  const STORE_KEY = 'zsf-created-at-v1';
  const ICON_CLASS = 'zsf-favicon';
  const TAB_UID_KEY = 'zsf-tab-uid-v1';
  const SNAPSHOT_KEY = 'zsf-before-sort-v1';
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
    if (src && icon.getAttribute('src') !== src) icon.setAttribute('src', src);
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
        if (created > snapshot.capturedAt + 1000) continue;
        map.set(item.id, tab);
        used.add(tab);
        urlMatches++;
      }
    }
    return { map, urlMatches };
  }

  // User-invoked escape hatch for v3 snapshots whose custom tab IDs no longer
  // exist. Never closes, recreates, reloads, pins or guesses tab identities.
  // All tabs in this mod's generated ordinary groups are left in their current
  // relative location; full historical order cannot be established from v3.
  async function rescueSiteGroups() {
    if (running) return;
    const current = workspace();
    const stored = readSnapshots();
    const snapshot = current && stored[current.id];
    if (!snapshot || ![3, 4].includes(snapshot.version)) {
      toast('目前沒有可救援的網站整理快照', true);
      return;
    }
    const created = snapshot.createdFolders || [];
    const getCreated = () => created.map(id => findGroupByID(current, id)).filter(group =>
      group?.isConnected && !group.isZenFolder &&
      group.parentElement === current.node.tabsContainer &&
      siteOfGroup(group)
    );
    if (snapshot.rescueCompleted) {
      const remaining = getCreated().some(group => [...group.querySelectorAll('tab')]
        .some(tab => tab.group === group && !tab.hasAttribute('zen-empty-tab')));
      if (remaining) {
        toast('仍有本工具建立的群組包含分頁；拒絕清除快照', true);
        return;
      }
      if (!window.confirm('已核對所有分頁都還存在，且接受無法保證恢復舊有順序嗎？\n確定後只清除本工作區的舊版整理快照（不可復原），不會關閉任何分頁。')) return;
      const next = { ...stored };
      delete next[current.id];
      if (writeSnapshots(next)) {
        toast('已清除舊整理快照，可以重新建立新的安全備份');
      } else {
        toast('快照清除失敗，原備份仍保留', true);
      }
      updateButtons();
      return;
    }
    const groups = getCreated();
    if (!groups.length) {
      toast('找不到這次整理建立的群組；未變更分頁或快照', true);
      return;
    }
    const candidates = [];
    for (const group of groups) {
      for (const tab of group.querySelectorAll('tab')) {
        if (tab.group !== group) continue;
        if (!eligible(tab)) {
          toast('救援停止：群組包含特殊或釘選分頁，未變更任何分頁', true);
          return;
        }
        candidates.push({ tab, group });
      }
    }
    if (!candidates.length) {
      toast('這次整理建立的群組沒有一般分頁；未變更任何分頁', true);
      return;
    }
    if (!window.confirm('安全拆分將解除本工具建立的 ' + groups.length +
      ' 個網站群組中的 ' + candidates.length + ' 個分頁，不關閉或重新載入網頁。\n' +
      '也可能解除整理後才加入群組的分頁，且無法保證回到原本的確切排序。\n' +
      '目前快照會保留。確定執行嗎？')) return;
    const browser = window.gBrowser;
    if (typeof browser?.ungroupTab !== 'function') {
      toast('Zen 不支援解除群組，未修改任何分頁', true); return;
    }
    running = true;
    updateButtons();
    let moved = 0, errors = 0;
    try {
      for (const group of groups) {
        try { group.collapsed = false; } catch (_) {}
        for (const {tab} of candidates.filter(item => item.group === group)) {
          if (!tab?.isConnected || tab.group !== group) { errors++; continue; }
          try {
            browser.ungroupTab(tab);
            if (tab.isConnected && tab.group !== group) moved++;
            else errors++;
          } catch (error) {
            errors++;
            console.warn(TAG, 'Rescue ungroup failed', error);
          }
        }
      }
      const remaining = getCreated().reduce((n, group) => n +
        [...group.querySelectorAll('tab')].filter(tab => tab.group === group).length, 0);
      if (!errors && !remaining) {
        snapshot.rescueCompleted = true;
        snapshot.rescueAt = Date.now();
        if (!writeSnapshots(stored)) {
          toast('分頁已拆分，但無法儲存救援進度；舊快照尚在', true);
        } else {
          toast('已安全拆分 ' + moved + ' 個分頁；未關閉分頁。請核對後右鍵箭頭完成備份清理');
        }
      } else {
        toast('救援部分完成：已拆分 ' + moved + ' 個；仍有 ' +
          remaining + ' 個分頁留在群組，錯誤 ' + errors + '；保留快照', true);
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
          .map(t => tabUID(t)).filter(id => item.tabs.includes(id));
        const intended = item.tabs.filter(id => tabMap.has(id));
        return actual.join('|') !== intended.join('|');
      }).length;
      const root = current.node.tabsContainer;
      const topLevel = [...(root.children || [])].map(el => {
        const tag = el.localName || el.tagName?.toLowerCase();
        if (tag === 'tab-group') return 'group:' + el.id;
        if (tag === 'tab') return 'tab:' + tabUID(el);
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
      if (undoButton) {
        undoButton.hidden = !Boolean(snapshots[node.id]);
        undoButton.disabled = running;
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
        // Preserve existing relative order within each site.
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
          // Do not reorder members or move the group into the pinned region.
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
        undoButton.setAttribute('tooltiptext', '左鍵還原；右鍵救援拆分／確認清除已核對快照（不關閉分頁）');
        undoButton.setAttribute('aria-label', '還原整理前的分頁');
        undoButton.addEventListener('command', () => undo().catch(e => console.error(TAG, e)));
        undoButton.addEventListener('contextmenu', event => {
          event.preventDefault();
          event.stopPropagation();
          rescueSiteGroups().catch(e => console.error(TAG, 'Safe rescue failed:', e));
        });
        separator.insertBefore(undoButton, line);
      }

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
    window.__zenSiteFoldersV025 = { organize, undo, rescueSiteGroups, reapplyAppearance, readSnapshots };
  }

  if (document.readyState === 'complete') initialize();
  else window.addEventListener('load', initialize, { once: true });
  window.addEventListener('unload', () => {
    clearTimeout(initTimer);
    if (waveFrame != null) cancelAnimationFrame(waveFrame);
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeSerial++;
  }, { once: true });
})();