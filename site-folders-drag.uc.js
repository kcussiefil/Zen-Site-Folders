// ==UserScript==
// @name         Zen Site Folders — 實際拖放與位置提示
// @version      0.4.1
// @description  Settle native drops once, using the layout captured before dragging.
// @include      chrome://browser/content/browser.xhtml
// ==/UserScript==
(() => {
  'use strict';
  if (window.__zsfDragV037) return;
  const GROUP = 'tab-group[data-zsf-site]:not([split-view-group])';
  const NS = 'http://www.w3.org/1999/xhtml';
  const THRESHOLD = 6;
  let pending = null, active = null, ghost = null, guide = null;
  let started = false, destroyed = false;
  const listeners = [];
  const tasks = new Set();
  let generation = 0;
  let lastWorkspace = window.gZenWorkspaces?.activeWorkspace;

  function bind(node, name, fn, opts) {
    node?.addEventListener?.(name, fn, opts);
    listeners.push([node, name, fn, opts]);
  }
  function ownGroup(node) {
    return !!node?.isConnected && node.matches?.(GROUP) &&
      !node.pinned && !node.isZenFolder;
  }
  function isPlainTab(node) {
    return !!node?.isConnected &&
      (node.localName === 'tab' || node.classList?.contains?.('tabbrowser-tab')) &&
      !node.pinned && !node.hasAttribute?.('zen-essential') &&
      !node.hasAttribute?.('zen-empty-tab') && !node.splitview &&
      !node.group?.hasAttribute?.('split-view-group');
  }
  function groupLabel(group) {
    return group?.querySelector?.(':scope > .tab-group-label-container');
  }
  function sourceFromEvent(event) {
    const path = event.composedPath?.() || [event.target];
    for (const node of path) {
      const label = node?.closest?.('.tab-group-label-container');
      const group = label?.parentElement;
      if (groupLabel(group) === label && ownGroup(group))
        return { kind: 'group', item: group, parent: group.parentElement };
      const tab = isPlainTab(node) ? node : node?.closest?.('.tabbrowser-tab');
      if (isPlainTab(tab) && !tab.multiselected && ownGroup(tab.group) &&
          !tab.group.hasAttribute('collapsed') && !tab.group.collapsed) {
        return { kind: 'tab', item: tab, parent: tab.group,
          container: tab.parentElement };
      }
    }
    return null;
  }
  function rectOf(element) {
    const target = element?.localName === 'tab-group' ?
      groupLabel(element) : element;
    const box = target?.getBoundingClientRect?.();
    return box?.width > 5 && box?.height > 5 ? { left: box.left, top: box.top,
      right: box.right, bottom: box.bottom, width: box.width, height: box.height } : null;
  }
  function itemName(item) {
    const label = item?.querySelector?.(
      ':scope > .tab-group-label-container > .tab-group-label') ||
      item?.querySelector?.('.tab-label') || item;
    return String(label?.textContent || item?.getAttribute?.('label') || '分頁')
      .trim().slice(0, 40);
  }
  function topLevelSiblings(item) {
    return Array.from(item?.parentElement?.children || []).filter(node =>
      node !== item && node.isConnected &&
      ((node.localName === 'tab-group' && !node.hasAttribute?.('split-view-group')) ||
        (isPlainTab(node) && !node.group)) && rectOf(node));
  }
  function groupMembers(group) {
    return [...(group?.querySelectorAll?.('tab') || group?.tabs || [])]
      .filter(tab => tab?.isConnected && tab.group === group &&
        !tab.pinned && !tab.hasAttribute?.('zen-essential'));
  }
  function point(event) {
    return { x: Number(event.clientX) || 0, y: Number(event.clientY) || 0 };
  }
  function withinSidebar(x, y) {
    const box = document.getElementById('navigator-toolbox')?.getBoundingClientRect?.();
    return !!box && x >= box.left && x <= box.right &&
      y >= box.top && y <= box.bottom;
  }
  function slotForGroup(source, x, y, layout) {
    if (!ownGroup(source) || !withinSidebar(x, y)) return null;
    const candidates = topLevelSiblings(source);
    if (!candidates.length) return null;
    const entries = (layout || candidates.map(item => ({ item, box: rectOf(item) })))
      .filter(entry => entry.box && entry.item.parentElement === source.parentElement)
      .sort((a, b) => a.box.top - b.box.top);
    if (!entries.length) return null;
    const first = entries[0], last = entries[entries.length - 1];
    // Include the thin gap ABOVE the first ordinary group. Older versions
    // rejected this region, making a group impossible to drag to the top.
    const space = source.closest?.('zen-workspace');
    const sep = space?.querySelector?.('.pinned-tabs-container-separator')
      ?.getBoundingClientRect?.();
    const normalTop = Math.max((sep?.bottom || 0) + 2,
      first.box.top - Math.max(55, first.box.height * 1.5));
    if (y < normalTop || y > last.box.bottom + 48 ||
        x < first.box.left - 24 || x > first.box.right + 24) return null;
    let chosen = first;
    if (y >= first.box.top) {
      chosen = entries.reduce((best, item) =>
        Math.abs(y - (item.box.top + item.box.height / 2)) <
          Math.abs(y - (best.box.top + best.box.height / 2)) ? item : best, first);
    }
    const before = y < chosen.box.top + chosen.box.height / 2;
    return { kind: 'group', source, target: chosen.item, before,
      markerY: before ? chosen.box.top : chosen.box.bottom,
      box: chosen.box };
  }
  function slotForMember(source, group, x, y, layout) {
    if (!isPlainTab(source) || (source.group !== group && (!layout || source.group)) || !ownGroup(group) ||
        (!layout && (group.hasAttribute('collapsed') || group.collapsed)) ||
        !withinSidebar(x, y)) return null;
    const members = groupMembers(group).filter(tab => tab !== source);
    if (!members.length) return null;
    const entries = (layout || members.map(item => ({ item, box: rectOf(item) })))
      .filter(entry => entry.item !== source)
      .filter(entry => entry.box).sort((a, b) => a.box.top - b.box.top);
    if (!entries.length) return null;
    const first = entries[0], last = entries[entries.length - 1];
    const header = rectOf(group);
    const minY = Math.max((header?.bottom || 0) - 5, first.box.top - 24);
    if (y < minY || y > last.box.bottom + 38 ||
        x < first.box.left - 24 || x > first.box.right + 24) return null;
    const chosen = y < first.box.top ? first :
      entries.reduce((best, item) =>
        Math.abs(y - (item.box.top + item.box.height / 2)) <
          Math.abs(y - (best.box.top + best.box.height / 2)) ? item : best, first);
    const before = y < chosen.box.top + chosen.box.height / 2;
    return { kind: 'tab', source, group, target: chosen.item, before,
      markerY: before ? chosen.box.top : chosen.box.bottom,
      box: chosen.box };
  }
  function chooseSlot(subject, x, y) {
    if (!subject) return null;
    const dy = (subject.scrolls || []).reduce((sum, item) => sum + item.node.scrollTop - item.top, 0);
    const layout = subject.layout?.map(entry => ({ item: entry.item, box: {
      ...entry.box, top: entry.box.top - dy, bottom: entry.box.bottom - dy
    } }));
    if (subject.kind === 'group') return slotForGroup(subject.item, x, y, layout);
    if (subject.kind === 'tab') return slotForMember(subject.item, subject.parent, x, y, layout);
    return null;
  }
  function captureLayout(subject) {
    const items = subject.kind === 'group' ? topLevelSiblings(subject.item) : groupMembers(subject.parent);
    return items.map(item => ({ item, box: rectOf(item) })).filter(entry => entry.box);
  }
  // Wait for observable native completion, not a guessed number of ms.
  // A busy/hidden window times out without applying a stale move.
  async function nativeIdle(group, valid = () => !destroyed) {
    await window.__zsfCollapseV037?.whenIdle?.(group);
    const start = Date.now();
    let quiet = 0;
    while (valid() && Date.now() - start < 4000) {
      await new Promise(resolve => setTimeout(resolve, 16));
      const strip = window.gBrowser?.tabContainer;
      const moving = strip?.hasAttribute?.('movingtab') || strip?.hasAttribute?.('movingtabgroup') ||
        strip?.hasAttribute?.('zia-settling') ||
        [...(strip?.getAnimations?.({ subtree: true }) || [])].some(animation => {
          if (animation.playState !== 'running' && animation.playState !== 'pending') return false;
          if (animation.effect?.getComputedTiming?.().iterations === Infinity) return false;
          return animation.effect?.getKeyframes?.().some(frame =>
            ['transform', 'translate', 'height', 'marginTop', 'marginBottom'].some(key => key in frame));
        });
      if (moving) quiet = 0;
      else if (++quiet === 2) return valid();
    }
    return false;
  }
  async function beforeMutation(group) {
    // The caller has not captured its display order yet. Complete an accepted
    // drop first, so ungroup cannot race Zia's queued placing or our correction.
    await Promise.all([...tasks].map(task => task.done));
    if (!await nativeIdle(group)) return false;
    generation++;
    reset();
    return true;
  }
  function create(tag, cssClass) {
    const el = document.createElementNS(NS, tag);
    el.className = cssClass;
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
  function ensureOverlays() {
    if (!ghost?.isConnected) {
      ghost = create('div', 'zsf-drag-ghost');
      const icon = create('img', 'zsf-drag-icon');
      const content = create('div', 'zsf-drag-texts');
      const title = create('span', 'zsf-drag-title');
      const hint = create('span', 'zsf-drag-hint');
      content.append(title, hint);
      ghost.append(icon, content);
      document.documentElement.appendChild(ghost);
    }
    if (!guide?.isConnected) {
      guide = create('div', 'zsf-drop-guide');
      guide.hidden = true;
      document.documentElement.appendChild(guide);
    }
  }
  function activate(subject, event) {
    if (active || !subject?.item?.isConnected) return;
    pending = null;
    active = subject;
    ensureOverlays();
    if (subject.kind === 'group') {
      const icon = groupLabel(subject.item)?.querySelector?.('.zsf-favicon');
      ghost.querySelector('.zsf-drag-icon').src = icon?.getAttribute?.('src') || '';
      ghost.querySelector('.zsf-drag-title').textContent = itemName(subject.item);
      subject.item.setAttribute('data-zsf-drag-source', 'true');
    } else {
      const icon = subject.item.querySelector?.('.tab-icon-image');
      ghost.querySelector('.zsf-drag-icon').src = icon?.getAttribute?.('src') || '';
      ghost.querySelector('.zsf-drag-title').textContent = itemName(subject.item);
      subject.item.setAttribute('data-zsf-drag-member', 'true');
    }
    ghost.querySelector('.zsf-drag-hint').textContent = '拖曳以調整順序';
    ghost.removeAttribute('data-invalid');
    ghost.hidden = false;
    update(event);
  }
  function update(event) {
    if (!active?.item?.isConnected || !ghost) return;
    const { x, y } = point(event);
    const width = ghost.offsetWidth || 178;
    const height = ghost.offsetHeight || 42;
    ghost.style.left = Math.round(Math.max(6,
      Math.min(x + 15, (window.innerWidth || 1280) - width - 6))) + 'px';
    ghost.style.top = Math.round(Math.max(6,
      Math.min(y + 12, (window.innerHeight || 800) - height - 6))) + 'px';
    const slot = chooseSlot(active, x, y);
    if (!slot) {
      guide.hidden = true;
      ghost.setAttribute('data-invalid', 'true');
      ghost.querySelector('.zsf-drag-hint').textContent = '此處無法調整順序';
      return;
    }
    ghost.removeAttribute('data-invalid');
    ghost.querySelector('.zsf-drag-hint').textContent =
      '移到「' + itemName(slot.target) + '」' + (slot.before ? '上方' : '下方');
    guide.hidden = false;
    guide.style.left = Math.round(slot.box.left + 7) + 'px';
    guide.style.width = Math.round(Math.max(16, slot.box.width - 14)) + 'px';
    guide.style.top = Math.round(slot.markerY - 1) + 'px';
    guide.setAttribute('data-position', slot.before ? 'before' : 'after');
  }
  function orderMatches(slot) {
    const { source, target, before } = slot;
    const parent = source?.parentElement;
    const items = slot.kind === 'group' ?
      [...(parent?.children || [])].filter(n => n.localName === 'tab-group' ||
        (isPlainTab(n) && !n.group)) :
      groupMembers(slot.group);
    const a = items.indexOf(source), b = items.indexOf(target);
    return a >= 0 && b >= 0 && (before ? a + 1 === b : b + 1 === a);
  }
  function commit(slot, context) {
    if (destroyed || !slot || !slot.source?.isConnected ||
        !slot.target?.isConnected || slot.source === slot.target) return false;
    const browser = window.gBrowser;
    if (!browser) return false;
    if (slot.kind === 'group') {
      if (!ownGroup(slot.source) || slot.source.parentElement !== context.parent ||
          slot.target.parentElement !== context.parent ||
          slot.source.pinned) return false;
    } else if (!ownGroup(context.parent) || slot.target.group !== context.parent ||
               slot.source.pinned || (slot.source.group && slot.source.group !== context.parent) ||
               (context.root && context.parent.parentElement !== context.root)) {
      return false;
    }
    // Only an accepted same-folder drop may restore membership if native
    // placing briefly ungrouped this exact original tab. Cross-folder drops,
    // multi-selection, split views and later user gestures never enter here.
    if (slot.kind === 'tab' && !slot.source.group) {
      if (typeof browser.moveTabToExistingGroup !== 'function') return false;
      browser.moveTabToExistingGroup(slot.source, context.parent);
      if (slot.source.group !== context.parent || slot.source.pinned) return false;
    }
    if (slot.kind === 'tab' && context.collapsed === false && context.parent.collapsed)
      context.parent.collapsed = false;
    if (orderMatches(slot)) return true; // Zen/Zia already did the requested move.
    try {
      if (slot.before) {
        if (typeof browser.moveTabBefore !== 'function') return false;
        browser.moveTabBefore(slot.source, slot.target);
      } else {
        if (typeof browser.moveTabAfter !== 'function') return false;
        browser.moveTabAfter(slot.source, slot.target);
      }
    } catch (error) {
      console.warn('[ZenSiteFoldersDrag] Native drop fallback failed:', error);
      return false;
    }
    if (!orderMatches(slot)) {
      console.warn('[ZenSiteFoldersDrag] Native drop order did not settle');
      return false;
    }
    return true;
  }
  function reset() {
    if (active?.kind === 'group')
      active.item?.removeAttribute?.('data-zsf-drag-source');
    if (active?.kind === 'tab')
      active.item?.removeAttribute?.('data-zsf-drag-member');
    active = pending = null;
    ghost?.remove();
    guide?.remove();
    ghost = guide = null;
  }
  function finish(event) {
    if (!active) { pending = null; return; }
    const slot = chooseSlot(active, point(event).x, point(event).y);
    const context = active;
    reset();
    if (!slot) return;
    const token = generation;
    const task = { done: null };
    task.done = (async () => {
      const valid = () => !destroyed && generation === token &&
        window.gZenWorkspaces?.activeWorkspace === context.workspace;
      if (await nativeIdle(context.parent, valid)) commit(slot, context);
    })().finally(() => tasks.delete(task));
    tasks.add(task);
  }

  function onDown(event) {
    if (event.button !== 0) return;
    const source = sourceFromEvent(event);
    generation++;
    pending = source ? { ...source, x: event.clientX, y: event.clientY,
      workspace: window.gZenWorkspaces?.activeWorkspace,
      scrolls: (event.composedPath?.() || []).filter(node => node?.scrollHeight > node?.clientHeight && typeof node.scrollTop === 'number')
        .map(node => ({ node, top: node.scrollTop })),
      layout: captureLayout(source), root: source.parent.parentElement,
      collapsed: source.parent.collapsed } : null;
  }
  function onMove(event) {
    if (!active) {
      if (!pending) return;
      if (!(event.buttons & 1)) { pending = null; return; }
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >= THRESHOLD)
        activate(pending, event);
    } else if (event.buttons & 1) update(event);
  }
  function onStart(event) {
    const source = pending?.item?.isConnected ? pending : sourceFromEvent(event);
    if (source && !source.layout) {
      source.layout = captureLayout(source);
      source.workspace = window.gZenWorkspaces?.activeWorkspace;
    }
    if (source) {
      activate(source, event);
      if (active) active.native = true;
    }
  }
  function onOver(event) {
    if (active) update(event);
  }
  function onKey(event) {
    if (event.key === 'Escape') { generation++; reset(); }
  }
  function start() {
    if (started || destroyed) return;
    const tabs = document.getElementById('tabbrowser-tabs');
    if (!tabs) return;
    started = true;
    bind(tabs, 'mousedown', onDown, true);
    bind(window, 'mousemove', onMove, true);
    bind(window, 'dragstart', onStart, true);
    bind(window, 'dragover', onOver, true);
    bind(window, 'drop', finish, true);
    bind(window, 'mouseup', () => { if (!active?.native) reset(); }, true);
    bind(window, 'dragend', reset, true);
    // Tab switching focuses the content browser and emits a window blur too.
    // Only OS-window deactivation cancels the gesture; descendant/content
    // focus changes must not erase the source captured on mousedown.
    bind(window, 'deactivate', () => { generation++; reset(); }, true);
    bind(window, 'keydown', onKey, true);
    bind(window, 'ZenWorkspacesUIUpdate', () => {
      const workspace = window.gZenWorkspaces?.activeWorkspace;
      if (workspace !== lastWorkspace) { generation++; reset(); }
      lastWorkspace = workspace;
    });
    bind(window, 'mousedown', () => { generation++; }, true);
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    reset();
    generation++;
    for (const [node, name, fn, opts] of listeners)
      try { node.removeEventListener(name, fn, opts); } catch (_) {}
    listeners.length = 0;
    if (window.__zsfDragV037 === api) delete window.__zsfDragV037;
  }
  const api = { start, destroy, version: '0.4.1', chooseSlot, commit, beforeMutation, nativeIdle };
  window.__zsfDragV037 = api;
  if (document.readyState === 'complete') start();
  else bind(window, 'load', start, { once: true });
  bind(window, 'unload', destroy, { once: true });
})();
