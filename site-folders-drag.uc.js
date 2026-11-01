// ==UserScript==
// @name         Zen Site Folders — 拖曳位置提示
// @version      0.3.6
// @description  Visual-only drag preview and same-level insertion guide; Zen/Zia owns drops.
// @include      chrome://browser/content/browser.xhtml
// ==/UserScript==
(() => {
  'use strict';
  if (window.__zsfDragV036) return;

  const GROUP = 'tab-group[data-zsf-site]:not([split-view-group])';
  const NS = 'http://www.w3.org/1999/xhtml';
  const MOVE_THRESHOLD = 6;
  let pending = null;
  let active = null;
  let ghost = null;
  let guide = null;
  let started = false;
  let destroyed = false;
  const listeners = [];

  function bind(node, name, callback, options) {
    node?.addEventListener?.(name, callback, options);
    listeners.push([node, name, callback, options]);
  }
  function ownGroup(node) {
    return node?.isConnected && node.matches?.(GROUP) &&
      !node.pinned && !node.isZenFolder;
  }
  function labelGroup(event) {
    const path = event.composedPath?.() || [event.target];
    for (const node of path) {
      const label = node?.closest?.('.tab-group-label-container');
      if (label && ownGroup(label.parentElement) &&
          label.parentElement.querySelector?.(':scope > .tab-group-label-container') === label) {
        return label.parentElement;
      }
    }
    return null;
  }
  function rowRect(row) {
    const header = row.matches?.(GROUP) ?
      row.querySelector(':scope > .tab-group-label-container') : row;
    const rect = header?.getBoundingClientRect?.();
    if (!rect || rect.width < 5 || rect.height < 5) return null;
    return rect;
  }
  function rowName(row) {
    const label = row.querySelector?.(':scope > .tab-group-label-container > .tab-group-label') ||
      row.querySelector?.('.tab-label') || row;
    return String(label.textContent || row.getAttribute?.('label') || '分頁')
      .trim().slice(0, 46);
  }
  function rowsAtSameLevel(source) {
    const parent = source?.parentElement;
    if (!parent?.children) return [];
    const all = Array.from(parent.children);
    return all.filter(node => {
      if (node === source || !node.isConnected) return false;
      if (node.matches?.('tab-group:not([split-view-group])')) return !!rowRect(node);
      if (node.matches?.('.tabbrowser-tab:not([pinned]), tab:not([pinned])') &&
          !node.group && !node.hasAttribute?.('zen-essential'))
        return !!rowRect(node);
      return false;
    });
  }
  function create(name, className) {
    const node = document.createElementNS(NS, name);
    node.className = className;
    node.setAttribute('aria-hidden', 'true');
    return node;
  }
  function ensureOverlays() {
    if (!ghost?.isConnected) {
      ghost = create('div', 'zsf-drag-ghost');
      const icon = create('img', 'zsf-drag-icon');
      const texts = create('div', 'zsf-drag-texts');
      const title = create('span', 'zsf-drag-title');
      const hint = create('span', 'zsf-drag-hint');
      texts.append(title, hint);
      ghost.append(icon, texts);
      document.documentElement.appendChild(ghost);
    }
    if (!guide?.isConnected) {
      guide = create('div', 'zsf-drop-guide');
      guide.hidden = true;
      document.documentElement.appendChild(guide);
    }
  }
  function point(event) {
    return { x: Number(event.clientX) || 0, y: Number(event.clientY) || 0 };
  }
  function withinSidebar(x, y) {
    const root = document.getElementById('navigator-toolbox');
    const box = root?.getBoundingClientRect?.();
    return !!box && x >= box.left && x <= box.right &&
      y >= box.top && y <= box.bottom;
  }
  function activate(group, event) {
    if (active || !ownGroup(group)) return;
    pending = null;
    active = { group, parent: group.parentElement };
    ensureOverlays();
    const icon = group.querySelector(':scope > .tab-group-label-container .zsf-favicon');
    const image = ghost.querySelector('.zsf-drag-icon');
    if (image) image.src = icon?.getAttribute?.('src') || '';
    ghost.querySelector('.zsf-drag-title').textContent = rowName(group);
    ghost.querySelector('.zsf-drag-hint').textContent = '拖曳以調整順序';
    ghost.removeAttribute('data-invalid');
    ghost.hidden = false;
    group.setAttribute('data-zsf-drag-source', 'true');
    update(event);
  }
  function hideGuide() {
    if (guide) guide.hidden = true;
    if (active?.group) ghost?.setAttribute?.('data-invalid', 'true');
    const hint = ghost?.querySelector?.('.zsf-drag-hint');
    if (hint) hint.textContent = '此處無法調整順序';
  }
  function chooseSlot(group, x, y) {
    if (!withinSidebar(x, y)) return null;
    const parent = group.parentElement;
    if (!parent || parent !== active?.parent) return null;
    const rows = rowsAtSameLevel(group);
    if (!rows.length) return null;
    let closest = null;
    for (const row of rows) {
      if (row.parentElement !== parent) continue;
      const rect = rowRect(row);
      if (!rect) continue;
      const center = rect.top + rect.height / 2;
      const gap = Math.abs(center - y);
      if (!closest || gap < closest.gap) closest = { row, rect, center, gap };
    }
    if (!closest) return null;
    const { row, rect, center } = closest;
    // Don't imply that a group can be dropped onto a nested tab or another
    // workspace. We only draw same-level before/after insertion markers.
    const before = y < center;
    const insertionY = before ? rect.top : rect.bottom;
    const parentBox = parent.getBoundingClientRect?.();
    if (!parentBox || x < Math.max(0, rect.left - 12) ||
        x > Math.min(window.innerWidth, rect.right + 12) ||
        y < Math.min(...rows.map(r => rowRect(r).top)) - 34 ||
        y > Math.max(...rows.map(r => rowRect(r).bottom)) + 34) return null;
    return { row, before, y: insertionY, rect };
  }
  function update(event) {
    const state = active;
    if (!state?.group?.isConnected || !ghost) return;
    const { x, y } = point(event);
    const width = ghost.offsetWidth || 170;
    const height = ghost.offsetHeight || 36;
    ghost.style.left = Math.round(Math.max(6,
      Math.min(x + 15, (window.innerWidth || 1280) - width - 6))) + 'px';
    ghost.style.top = Math.round(Math.max(6,
      Math.min(y + 12, (window.innerHeight || 800) - height - 6))) + 'px';
    const slot = chooseSlot(state.group, x, y);
    if (!slot) { hideGuide(); return; }
    ghost.removeAttribute('data-invalid');
    const hint = ghost.querySelector('.zsf-drag-hint');
    hint.textContent = '移到「' + rowName(slot.row) + '」' + (slot.before ? '上方' : '下方');
    guide.hidden = false;
    guide.style.left = Math.round(slot.rect.left + 7) + 'px';
    guide.style.width = Math.round(Math.max(16, slot.rect.width - 14)) + 'px';
    guide.style.top = Math.round(slot.y - 1) + 'px';
    guide.setAttribute('data-position', slot.before ? 'before' : 'after');
  }
  function reset() {
    if (active?.group?.isConnected) active.group.removeAttribute('data-zsf-drag-source');
    pending = null;
    active = null;
    ghost?.remove();
    guide?.remove();
    ghost = null;
    guide = null;
  }
  function onDown(event) {
    if (event.button !== 0) return;
    const group = labelGroup(event);
    pending = group ? { group, x: event.clientX, y: event.clientY } : null;
  }
  function onMouseMove(event) {
    if (!active) {
      if (!pending) return;
      if (!(event.buttons & 1)) { pending = null; return; }
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >= MOVE_THRESHOLD)
        activate(pending.group, event);
    } else if (event.buttons & 1) update(event);
  }
  function onDragStart(event) {
    const group = labelGroup(event) ||
      (pending?.group?.isConnected ? pending.group : null);
    if (group) activate(group, event);
  }
  function onDragOver(event) {
    if (active) update(event);
  }
  function onKeyDown(event) {
    if (event.key === 'Escape') reset();
  }
  function start() {
    if (started || destroyed) return;
    const tabs = document.getElementById('tabbrowser-tabs');
    if (!tabs) return;
    started = true;
    // Observe native Zen/Zia drag-and-drop without preventDefault,
    // stopPropagation, setDragImage, dropEffect or moving any tab/group.
    bind(tabs, 'mousedown', onDown, true);
    bind(window, 'mousemove', onMouseMove, true);
    bind(window, 'dragstart', onDragStart, true);
    bind(window, 'dragover', onDragOver, true);
    bind(window, 'mouseup', reset, true);
    bind(window, 'dragend', reset, true);
    bind(window, 'drop', reset, true);
    bind(window, 'blur', reset, true);
    bind(window, 'keydown', onKeyDown, true);
    bind(window, 'ZenWorkspacesUIUpdate', reset);
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    reset();
    for (const [node, name, handler, options] of listeners)
      try { node.removeEventListener(name, handler, options); } catch (_) {}
    listeners.length = 0;
    if (window.__zsfDragV036 === api) delete window.__zsfDragV036;
  }
  const api = { start, destroy, version: '0.3.6', chooseSlot };
  window.__zsfDragV036 = api;
  if (document.readyState === 'complete') start();
  else bind(window, 'load', start, { once: true });
  bind(window, 'unload', destroy, { once: true });
})();
