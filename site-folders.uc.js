// ==UserScript==
// @name         Zen Site Folders
// @version      0.1.5
// @description  Group all normal tabs by website and show locally cached favicons.
// @include      chrome://browser/content/browser.xhtml
// ==/UserScript==
(() => {
  'use strict';
  if (window.__zenSiteFoldersV015) return;
  window.__zenSiteFoldersV015 = true;

  const TAG = '[ZenSiteFolders]';
  const STORE_KEY = 'zsf-created-at-v1';
  const ICON_CLASS = 'zsf-favicon';
  const TAB_UID_KEY = 'zsf-tab-uid-v1';
  const SNAPSHOT_KEY = 'zsf-before-sort-v1';
  const OWNED_GROUPS_KEY = 'zsf-owned-group-sites-v1';
  const MIN_WAVE_MS = 750;
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
    'discord.com': 'Discord', 'notion.so': 'Notion'
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
  const legacyBase = Date.now() - 86_400_000;
  let SessionStore = null;
  try {
    ({ SessionStore } = ChromeUtils.importESModule('resource:///modules/sessionstore/SessionStore.sys.mjs'));
  } catch (error) {
    console.warn(TAG, 'SessionStore unavailable; new/old order will be per session:', error);
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
        if (tab?.isConnected && !tab.hasAttribute('cloned') &&
            tab.getAttribute('zen-workspace-id') === id) tabs.add(tab);
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
    for (const raw of [
      tab?.linkedBrowser?.currentURI?.spec,
      tab?.getAttribute('linkedpanel-url'),
      tab?.getAttribute('url')
    ]) {
      if (typeof raw === 'string' && /^https?:\/\//i.test(raw)) return raw;
    }
    // Restored/sleeping tabs may only carry their URL in SessionStore.
    try {
      const json = SessionStore?.getTabState(tab);
      if (json) {
        const state = JSON.parse(json);
        const entry = state.entries?.[(state.index || state.entries?.length || 1) - 1];
        if (/^https?:\/\//i.test(entry?.url || '')) return entry.url;
      }
    } catch (_) {}
    return null;
  }

  function siteFor(raw) {
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
      const saved = Number(SessionStore?.getCustomTabValue(tab, STORE_KEY));
      if (Number.isFinite(saved) && saved > 0) return saved;
    } catch (_) {}
    if (Number.isFinite(tab.__zsfOpenedAt)) return tab.__zsfOpenedAt;
    // Historical tabs have no reliably exposed creation time: retain their
    // current relative order as the initial ordering baseline.
    const fallback = legacyBase + (Number(tab._tPos) || 0);
    tab.__zsfOpenedAt = fallback;
    try { SessionStore?.setCustomTabValue(tab, STORE_KEY, String(fallback)); } catch (_) {}
    return fallback;
  }

  function noteNewTab(tab) {
    if (!tab || tab.__zsfOpenedAt) return;
    // During session restore, do not overwrite the original creation stamp.
    try {
      const restored = Number(SessionStore?.getCustomTabValue(tab, STORE_KEY));
      if (Number.isFinite(restored) && restored > 0) {
        tab.__zsfOpenedAt = restored;
        return;
      }
    } catch (_) {}
    const stamp = Date.now() + (++seq / 1000);
    tab.__zsfOpenedAt = stamp;
    try { SessionStore?.setCustomTabValue(tab, STORE_KEY, String(stamp)); } catch (_) {}
  }

  function getGroups(node) {
    return [...(node.tabsContainer?.querySelectorAll('tab-group:not([split-view-group])') || [])]
      .filter(g => g.isConnected && !g.hasAttribute('cloned'));
  }

  // DOM attributes are not guaranteed to survive session restore. Persist
  // ONLY our own group IDs, never infer ownership from another mod's label.
  function readOwnedSites() {
    try {
      const raw = SessionStore?.getCustomWindowValue?.(window, OWNED_GROUPS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { return {}; }
  }

  function rememberOwnedSite(group, site) {
    if (!group?.id || !site || !SessionStore?.setCustomWindowValue) return;
    try {
      const owned = readOwnedSites();
      if (owned[group.id] === site) return;
      owned[group.id] = site;
      SessionStore.setCustomWindowValue(window, OWNED_GROUPS_KEY, JSON.stringify(owned));
    } catch (error) { console.warn(TAG, 'Could not persist site group ID:', error); }
  }

  function forgetOwnedSite(group) {
    if (!group?.id || !SessionStore?.setCustomWindowValue) return;
    try {
      const owned = readOwnedSites();
      if (!(group.id in owned)) return;
      delete owned[group.id];
      SessionStore.setCustomWindowValue(window, OWNED_GROUPS_KEY, JSON.stringify(owned));
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
    return getGroups(node).find(g => siteOfGroup(g) === site) || null;
  }

  function sourceFaviconURL(tab) {
    const raw = tabURL(tab);
    if (!raw) return null;
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
    if (!SessionStore?.getCustomTabValue || !SessionStore?.setCustomTabValue) return null;
    try {
      const old = SessionStore.getCustomTabValue(tab, TAB_UID_KEY);
      if (old) return old;
      const id = 'tab-' + (Services.uuid?.generateUUID?.()?.toString?.() ||
        `${Date.now().toString(36)}-${++uidSeq}`);
      SessionStore.setCustomTabValue(tab, TAB_UID_KEY, id);
      return SessionStore.getCustomTabValue(tab, TAB_UID_KEY) === id ? id : null;
    } catch (error) {
      console.warn(TAG, 'Unable to save a tab identity:', error);
      return null;
    }
  }

  function readSnapshots() {
    try {
      const raw = SessionStore?.getCustomWindowValue?.(window, SNAPSHOT_KEY);
      const parsed = raw && JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { return {}; }
  }

  function writeSnapshots(next) {
    if (!SessionStore?.setCustomWindowValue || !SessionStore?.getCustomWindowValue) return false;
    try {
      const serialized = JSON.stringify(next);
      SessionStore.setCustomWindowValue(window, SNAPSHOT_KEY, serialized);
      return SessionStore.getCustomWindowValue(window, SNAPSHOT_KEY) === serialized;
    } catch (error) {
      console.error(TAG, 'Undo backup could not be saved:', error);
      return false;
    }
  }

  function captureSnapshot(current) {
    const root = current.node.tabsContainer;
    if (!root?.children) return null;
    const elements = [];
    const tabs = [];
    const seen = new Set();
    for (const element of root.children) {
      if (!element?.isConnected) continue;
      const tag = element.localName || element.tagName?.toLowerCase();
      if (tag === 'tab-group' && !element.hasAttribute('split-view-group')) {
        if (!element.id) return null; // Exact restoration requires group identity.
        const members = [...element.querySelectorAll('tab')]
          .filter(t => t.isConnected && t.group === element);
        const ids = [];
        for (const tab of members) {
          const id = tabUID(tab);
          if (!id || seen.has(id)) return null;
          seen.add(id);
          ids.push(id);
          tabs.push({ id, group: element.id });
        }
        elements.push({
          type: 'group', id: element.id, label: String(element.label || element.getAttribute('label') || ''),
          color: String(element.color || element.getAttribute('color') || ''),
          collapsed: element.hasAttribute('collapsed'),
          site: siteOfGroup(element), tabs: ids
        });
      } else if (tag === 'tab') {
        if (element.getAttribute('zen-workspace-id') !== current.id) continue;
        const id = tabUID(element);
        if (!id || seen.has(id)) return null;
        seen.add(id);
        tabs.push({ id, group: null });
        elements.push({ type: 'tab', id });
      } else if (tag === 'tab-group' && element.hasAttribute('split-view-group')) {
        // No modified tabs in splits: leave that wrapper untouched.
      }
    }
    // If Zen has a different wrapper, do not run a destructive sort with an
    // incomplete snapshot. Only normal non-pinned/non-split tabs count here.
    const needsBackup = allWorkspaceTabs(current.node, current.id).filter(t =>
      eligible(t) && !t.closest('tab-group[split-view-group]'));
    if (needsBackup.some(t => !seen.has(tabUID(t)))) return null;
    return { version: 1, workspaceId: current.id, capturedAt: Date.now(), elements, tabs };
  }

  function findTabMap(current) {
    const map = new Map();
    for (const tab of allWorkspaceTabs(current.node, current.id)) {
      const id = tabUID(tab);
      if (id) map.set(id, tab);
    }
    return map;
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
    if (!window.gBrowser?.ungroupTab || !window.gBrowser?.moveTabBefore) {
      toast('Zen 的原生還原 API 不可用，未修改分頁'); return;
    }
    running = true;
    updateButtons();
    let errors = 0;
    let missing = 0;
    try {
      const tabMap = findTabMap(current);
      missing = snapshot.tabs.filter(x => !tabMap.has(x.id)).length;
      // 1) Re-create lost manual groups with their original stable ID, label,
      // colour and members. This also covers groups emptied by sorting.
      for (const original of snapshot.elements.filter(x => x.type === 'group')) {
        let group = findGroupByID(current, original.id);
        const desired = original.tabs.map(id => tabMap.get(id)).filter(t => t?.isConnected);
        if (!group && desired.length) {
          try {
            group = window.gBrowser.addTabGroup([desired[0]], {
              id: original.id, label: original.label, color: original.color || undefined
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
      // 5) Verify membership and within-group order. Do not discard a
      // recoverable backup if any step failed or some old tabs were closed.
      const wrong = snapshot.tabs.filter(item => {
        const tab = tabMap.get(item.id);
        if (!tab?.isConnected) return false;
        return (tab.group?.id || null) !== item.group;
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
      if (errors || missing || wrong || wrongSequence || wrongTopLevel) {
        toast(`部分還原：遺失 ${missing}、分組不符 ${wrong}、順序不符 ${wrongSequence + Number(wrongTopLevel)}、操作錯誤 ${errors}；已保留備份`);
        console.warn(TAG, 'Undo incomplete', { errors, missing, wrong, wrongSequence, wrongTopLevel });
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
    if (svg && line) {
      // Align the effect with the actual native separator's current geometry.
      // It adjusts automatically when Undo appears or the sidebar is resized.
      const hostRect = separator.getBoundingClientRect();
      const lineRect = line.getBoundingClientRect();
      svg.style.setProperty('--zsf-wave-left', Math.max(0, lineRect.left - hostRect.left).toFixed(1) + 'px');
      svg.style.setProperty('--zsf-wave-width', Math.max(0, lineRect.width).toFixed(1) + 'px');
    }
    separator.classList.add('zsf-is-sorting');
    waveStart = performance.now();
    waveEnding = false;
    const step = now => {
      const svg = separator.querySelector('.zsf-wave');
      const path = svg?.querySelector('.zsf-wave-path');
      if (!path || !separator.isConnected) { waveFrame = null; return; }
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

  function toast(message) {
    console.log(TAG, message);
    try { window.gZenUIManager?.showToast?.(message); } catch (_) {}
  }

  async function organize() {
    if (running) return;
    const current = workspace();
    if (!current || !window.gBrowser?.addTabGroup || !window.gBrowser?.moveTabToExistingGroup ||
        !window.gBrowser?.ungroupTab || !window.gBrowser?.moveTabBefore) {
      toast('無法取得目前 Zen 工作區或分頁群組 API');
      return;
    }
    const snapshots = readSnapshots();
    if (!snapshots[current.id]) {
      const backup = captureSnapshot(current);
      if (!backup || !writeSnapshots({ ...snapshots, [current.id]: backup })) {
        toast('無法完整保存整理前狀態，已取消整理（沒有移動分頁）');
        return;
      }
    }
    running = true;
    startWave();
    updateButtons();
    try {
      const all = allWorkspaceTabs(current.node, current.id);
      const buckets = new Map();
      const skipped = [];
      for (const tab of all) {
        if (!eligible(tab)) { skipped.push(tab); continue; }
        const raw = tabURL(tab);
        const site = siteFor(raw);
        if (!site) { skipped.push(tab); continue; }
        if (!buckets.has(site)) buckets.set(site, []);
        buckets.get(site).push({ tab, order: openedAt(tab) });
      }
      const beforeCount = [...buckets.values()].reduce((s, l) => s + l.length, 0);
      let errors = 0;
      for (const [site, items] of buckets) {
        // Sort newest first. Existing tabs are initially inferred from the strip.
        items.sort((a, b) => b.order - a.order);
        let group = findGroup(current.node, site);
        const pending = items.map(x => x.tab).filter(t => t.isConnected && (!group || t.group !== group));
        try {
          if (!group && pending.length) {
            const first = pending[0];
            // A tab from an existing Zia folder is NOT a safe insertBefore
            // anchor in Zen: it can nest a new group inside the old one.
            // Let Firefox append a top-level group; undo restores positions.
            group = window.gBrowser.addTabGroup([first], {
              label: nameFor(site)
            });
          }
          if (!group?.isConnected) { errors += items.length; continue; }
          for (const tab of items.map(x => x.tab)) {
            if (!tab.isConnected || tab.group === group) continue;
            try { window.gBrowser.moveTabToExistingGroup(tab, group); }
            catch (e) { errors++; console.warn(TAG, 'Group move failed:', site, e); }
          }
          decorate(group, site, items[0]?.tab);
          reorderGroup(group, items.map(x => x.tab));
        } catch (e) {
          errors += items.length;
          console.error(TAG, 'Group creation failed:', site, e);
        }
      }
      // Verification: count eligible website tabs left in the wrong group.
      let missing = 0;
      for (const [site, items] of buckets) {
        for (const {tab} of items) {
          if (tab.isConnected && siteOfGroup(tab.group) !== site) missing++;
        }
      }
      toast(`網站整理：${beforeCount} 個分頁、${buckets.size} 個網站群組；未完成 ${missing}、略過 ${skipped.length}`);
      if (missing || errors) console.warn(TAG, { missing, errors, skipped: skipped.length });
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
        undoButton.setAttribute('tooltiptext', '還原整理前的分頁順序及群組（不關閉任何分頁）');
        undoButton.setAttribute('aria-label', '還原整理前的分頁');
        undoButton.addEventListener('command', () => undo().catch(e => console.error(TAG, e)));
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
    window.__zenSiteFoldersV015 = { organize, undo, reapplyAppearance, readSnapshots };
  }

  if (document.readyState === 'complete') initialize();
  else window.addEventListener('load', initialize, { once: true });
  window.addEventListener('unload', () => {
    clearTimeout(initTimer);
    if (waveFrame != null) cancelAnimationFrame(waveFrame);
  }, { once: true });
})();