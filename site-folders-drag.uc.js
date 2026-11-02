// ==UserScript==
// @name         Zen Site Folders — 實際拖放與位置提示
// @version      0.6.1
// @description  Settle native drops once, using the layout captured before dragging.
// @include      chrome://browser/content/browser.xhtml
// ==/UserScript==
(() => {
  'use strict';
  if (window.__zsfDragV037) return;
  const GROUP = 'tab-group[data-zsf-site]:not([split-view-group])';
  const NS = 'http://www.w3.org/1999/xhtml';
  const THRESHOLD = 6;
  const EDGE_ZONE = 52;
  let pending = null, active = null, ghost = null;
  let nativeBlank = null, autoFrame = 0, autoPointer = null;
  let started = false, destroyed = false;
  const listeners = [];
  const tasks = new Set();
  let generation = 0;
  let lastWorkspace = window.gZenWorkspaces?.activeWorkspace;
  let ziaShim = null, ziaDelegate = null, ziaCleanupTimer = 0;
  let ziaScrollBridge = null;

  function stopZiaScrollBridge() {
    const bridge = ziaScrollBridge;
    ziaScrollBridge = null;
    if (bridge) for (const undo of bridge.undo.reverse()) undo();
    if (!active && autoFrame) window.cancelAnimationFrame?.(autoFrame);
    if (!active) { autoFrame = 0; autoPointer = null; }
  }
  function installZiaScrollBridge(context) {
    stopZiaScrollBridge();
    const port = context?.scrollPort;
    if (!port || !context.item?.isConnected) return false;
    if (typeof Cc === 'undefined' || typeof Ci === 'undefined') return false;
    const bridge = { context, initialTop: port.scrollTop, expectedTop: port.scrollTop,
      contentHeight: port.scrollHeight,
      nativeUntil: 0, undo: [], repaint: null };
    try {
      const service = Cc['@mozilla.org/eventlistenerservice;1']
        .getService(Ci.nsIEventListenerService);
      for (const host of [window, document.getElementById('tabbrowser-tabs')].filter(Boolean)) {
        for (const info of service.getListenerInfoFor(host)) {
          const original = info.listenerObject;
          if (info.type !== 'dragover' || !info.capturing || typeof original !== 'function') continue;
          const code = String(original);
          // Fail closed if Zia changes this private coordinate calculation.
          if (!code.includes('event.clientY - drag.clientY') ||
              !code.includes('pointerOf(event)') || !code.includes('apply(dy)') ||
              !code.includes('drag.firstTop')) continue;
          const wrapped = event => {
            bridge.lastEvent = event;
            const delta = port.scrollTop - bridge.initialTop;
            if (!delta || !withinSidebar(event.clientX, event.clientY))
              return original.call(host, event);
            const undo = [];
            try {
              // Zia's cached rows stay in starting-content coordinates.
              // Translate physical UI hit boxes into the same frame only
              // during its callback; the actual DOM event stays unchanged.
              const boxes = new Set([document.getElementById('navigator-toolbox'),
                document.getElementById('zen-essentials'),
                window.gZenWorkspaces?.getCurrentEssentialsContainer?.(),
                document.querySelector?.('.zen-essentials-container')].filter(Boolean));
              for (const node of boxes) {
                const descriptor = Object.getOwnPropertyDescriptor(node, 'getBoundingClientRect');
                const getBox = node.getBoundingClientRect;
                Object.defineProperty(node, 'getBoundingClientRect', {configurable:true, value() {
                  const r = getBox.call(node);
                  return {x:r.x,y:r.y+delta,left:r.left,right:r.right,
                    top:r.top+delta,bottom:r.bottom+delta,width:r.width,height:r.height};
                }});
                undo.push(() => {
                  if (descriptor) Object.defineProperty(node, 'getBoundingClientRect', descriptor);
                  else delete node.getBoundingClientRect;
                });
              }
              const translated = new Proxy(event, {get(target, key) {
                const value = Reflect.get(target, key, target);
                if (key === 'clientY' || key === 'screenY') return value + delta;
                return typeof value === 'function' ? value.bind(target) : value;
              }});
              return original.call(host, translated);
            } finally { for (const restore of undo.reverse()) restore(); }
          };
          host.removeEventListener('dragover', original, true);
          host.addEventListener('dragover', wrapped, true);
          bridge.undo.push(() => {
            host.removeEventListener('dragover', wrapped, true);
            host.addEventListener('dragover', original, true);
          });
          bridge.repaint ||= () => bridge.lastEvent && wrapped(bridge.lastEvent);
        }
      }
      if (!bridge.undo.length) return false;
      ziaScrollBridge = bridge;
      // Capture the native preview only after its translated update.
      window.removeEventListener('dragover', onOver, true);
      window.addEventListener('dragover', onOver, true);
      return true;
    } catch (error) {
      for (const undo of bridge.undo.reverse()) undo();
      console.warn('[ZenSiteFoldersDrag] Native scroll adapter unavailable:', error);
      return false;
    }
  }

  // Zia detects a whole native folder by isZenFolder in its tabFromEvent()
  // and begin() functions. That flag must NEVER be stored on our normal
  // group outside a gesture: Zen's folder lifecycle also checks it.
  function restoreZiaShim() {
    if (ziaCleanupTimer) { clearTimeout(ziaCleanupTimer); ziaCleanupTimer = 0; }
    const shim = ziaShim;
    ziaShim = null;
    if (shim?.group) {
      try {
        if (shim.ownDescriptor)
          Object.defineProperty(shim.group, 'isZenFolder', shim.ownDescriptor);
        else delete shim.group.isZenFolder;
      } catch (error) {
        console.warn('[ZenSiteFoldersDrag] Failed to restore folder identity:', error);
      }
    }
    for (const undo of (shim?.landingUndo || []).reverse()) undo();
    if (shim?.folders && shim.originalCanDrop) {
      try {
        if (shim.folders.canDropElement === shim.wrappedCanDrop)
          shim.folders.canDropElement = shim.originalCanDrop;
      } catch (_) {}
    }
  }
  function primeZiaShim(subject) {
    if (window.__ziaLoaded !== true || subject?.kind !== 'group' ||
        !ownGroup(subject.item)) return false;
    restoreZiaShim();
    const group = subject.item;
    const ownDescriptor = Object.getOwnPropertyDescriptor(group, 'isZenFolder');
    if (ownDescriptor && !ownDescriptor.configurable) return false;
    const shim = { group, ownDescriptor, folders: null,
      originalCanDrop: null, wrappedCanDrop: null };
    try {
      Object.defineProperty(group, 'isZenFolder', { configurable: true, value: true });
      // Zia's canNest() consults this one Zen method. Do not allow owned
      // website folders to become children of another folder: only
      // existing same-level ordering is supported by our snapshots.
      const folders = window.gZenFolders;
      if (folders && typeof folders.canDropElement === 'function') {
        const original = folders.canDropElement;
        const wrapped = function(element, target) {
          // Site Folders are deliberately flat. Zia calls canNest()
          // both for hovered descendants and their closest folder.
          // Deny ALL nesting of the dragged site group rather than
          // relying on the queried target node's .closest() chain.
          if (element === group) return false;
          return original.call(this, element, target);
        };
        folders.canDropElement = wrapped;
        shim.folders = folders;
        shim.originalCanDrop = original;
        shim.wrappedCanDrop = wrapped;
      }
      ziaShim = shim;
      prepareZiaLanding({ group, parent: group.parentElement,
        landingBefore: group.nextElementSibling,
        workspace: window.gZenWorkspaces?.activeWorkspace, accepted: false });
      return true;
    } catch (error) {
      ziaShim = shim;
      restoreZiaShim();
      console.warn('[ZenSiteFoldersDrag] Zia adapter unavailable:', error);
      return false;
    }
  }
  function ziaIsDragging() {
    return document.documentElement.hasAttribute?.('zia-dragging-tab') === true;
  }
  function releaseZiaAfterDrop() {
    stopZiaScrollBridge();
    ziaDelegate = null;
    if (ziaCleanupTimer) clearTimeout(ziaCleanupTimer);
    // Zia's finishFolderDrop is queued via setTimeout(0). Restore native
    // identities after that callback, never inside the drop dispatch.
    ziaCleanupTimer = setTimeout(() => {
      ziaCleanupTimer = 0;
      restoreZiaShim();
    }, 0);
  }

  function bind(node, name, fn, opts) {
    node?.addEventListener?.(name, fn, opts);
    listeners.push([node, name, fn, opts]);
  }
  function ownGroup(node) {
    return !!node?.isConnected && node.matches?.(GROUP) &&
      !node.pinned && (!node.isZenFolder || ziaShim?.group === node);
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
  // The real scrollport is often inside Zen's arrowscrollbox shadow DOM,
  // not an ancestor in mouseEvent.composedPath().
  function findScrollPort(subject) {
    const space = subject?.item?.closest?.('zen-workspace') ||
      window.gZenWorkspaces?.activeWorkspaceElement;
    const candidates = [
      space?.scrollbox?.scrollbox,
      space?.scrollbox,
      space?.querySelector?.('.workspace-arrowscrollbox')?.scrollbox,
      space?.querySelector?.('.workspace-arrowscrollbox'),
      window.gZenWorkspaces?.activeWorkspaceElement?.scrollbox?.scrollbox
    ];
    return candidates.find(node => node && node.isConnected !== false &&
      typeof node.scrollTop === 'number' && node.scrollHeight > node.clientHeight + 3 &&
      typeof node.getBoundingClientRect === 'function') || null;
  }
  function captureScrolls(event, port) {
    const found = (event.composedPath?.() || []).filter(node =>
      node?.scrollHeight > node?.clientHeight && typeof node.scrollTop === 'number');
    if (port && !found.includes(port)) found.push(port);
    return found.map(node => ({ node, top: node.scrollTop }));
  }
  function scrollSpeed(subject, x, y) {
    const port = subject?.scrollPort;
    if (!port) return 0;
    const nav = document.getElementById('navigator-toolbox')?.getBoundingClientRect?.();
    const box = port.getBoundingClientRect();
    if (!nav || x < nav.left || x > nav.right ||
        x < box.left - 8 || x > box.right + 8) return 0;
    const sep = subject.item?.closest?.('zen-workspace')
      ?.querySelector?.('.pinned-tabs-container-separator')?.getBoundingClientRect?.();
    const top = Math.max(box.top, (sep?.bottom || box.top) + 3);
    const bottom = Math.min(box.bottom, nav.bottom);
    if (bottom - top < EDGE_ZONE * 2 || y < top - 20 || y > bottom + 20) return 0;
    const upper = y < top + EDGE_ZONE ? -(top + EDGE_ZONE - y) / EDGE_ZONE : 0;
    const lower = y > bottom - EDGE_ZONE ? (y - bottom + EDGE_ZONE) / EDGE_ZONE : 0;
    const edge = Math.max(-1, Math.min(1, upper || lower));
    return edge ? Math.sign(edge) *
      Math.max(2, Math.round(2 + 14 * Math.abs(edge) ** 1.5)) : 0;
  }
  function autoScrollTick() {
    autoFrame = 0;
    const subject = active || (ziaScrollBridge?.context === ziaDelegate ? ziaDelegate : null);
    if (!subject || !autoPointer || !subject.scrollPort) return;
    if (!active && (!ziaIsDragging() || !subject.item.isConnected ||
        subject.workspace !== window.gZenWorkspaces?.activeWorkspace)) return;
    const { x, y } = autoPointer;
    const speed = scrollSpeed(subject, x, y);
    if (!speed) return;
    const port = subject.scrollPort;
    if (!active) {
      // Yield while Zen or the user is already changing this scrollport.
      if (Math.abs(port.scrollTop - ziaScrollBridge.expectedTop) > .1) {
        ziaScrollBridge.expectedTop = port.scrollTop;
        ziaScrollBridge.nativeUntil = Date.now() + 120;
      }
      if (Date.now() < ziaScrollBridge.nativeUntil) {
        autoFrame = window.requestAnimationFrame?.(autoScrollTick) || 0;
        return;
      }
    }
    const before = port.scrollTop;
    // The translated dragged row can enlarge scrollable overflow. It is
    // not new content and must never extend the scrolling destination.
    const contentHeight = active ? port.scrollHeight :
      Math.min(port.scrollHeight, ziaScrollBridge.contentHeight);
    const max = Math.max(0, contentHeight - port.clientHeight);
    const next = Math.min(max, Math.max(0, before + speed));
    try {
      // Zen can enable smooth scrolling on the arrowscrollbox. Override it
      // for the animation frame so repeated drag-scroll ticks don't queue up.
      if (typeof port.scrollTo === 'function')
        port.scrollTo({ top: next, behavior: 'instant' });
      else port.scrollTop = next;
    } catch (_) { port.scrollTop = next; }
    if (Math.abs(port.scrollTop - before) <= .1) return;
    // Recompute against actual scrollTop; never move any tab in this loop.
    if (active) update({ clientX: x, clientY: y }, false);
    else {
      ziaScrollBridge.expectedTop = port.scrollTop;
      // Reuse Zia's renderer with the last real OS event. No synthetic
      // drag event, competing row shifts, or tab movement is generated.
      ziaScrollBridge.repaint?.();
      if (subject.kind === 'group') captureZiaGap(subject);
    }
    autoFrame = window.requestAnimationFrame?.(autoScrollTick) || 0;
  }
  function scheduleAutoScroll(x, y) {
    autoPointer = { x, y };
    const subject = active || (ziaScrollBridge?.context === ziaDelegate ? ziaDelegate : null);
    if (!autoFrame && subject?.scrollPort && scrollSpeed(subject, x, y))
      autoFrame = window.requestAnimationFrame?.(autoScrollTick) || 0;
  }
  function captureAvoidRows(subject) {
    if (subject.kind !== 'group') return [];
    return [...(subject.parent?.children || [])].filter(node =>
      node === subject.item ||
      (node.localName === 'tab-group' && !node.hasAttribute?.('split-view-group')) ||
      (isPlainTab(node) && !node.group));
  }
  function beginAvoidance(subject) {
    if (subject.kind !== 'group') return;
    subject.avoidRows = captureAvoidRows(subject);
    subject.dragPitch = Math.min(70, Math.max(30,
      rectOf(subject.item)?.height || 35));
    subject.avoidOffsets = new Map();
    for (const node of subject.avoidRows) {
      if (node === subject.item) continue;
      node.setAttribute('data-zsf-drag-avoid', 'true');
      node.style?.setProperty?.('--zsf-drag-avoid-y', '0px');
    }
    // Establish 0px as the computed base before changing it to the first
    // target; otherwise style coalescing would snap the FIRST avoidance.
    subject.avoidRows.find(node => node !== subject.item)
      ?.getBoundingClientRect?.();
  }
  function updateAvoidance(subject, slot) {
    if (subject?.kind !== 'group' || !subject.avoidRows) return;
    const rows = subject.avoidRows;
    const from = rows.indexOf(subject.item), target = rows.indexOf(slot?.target);
    const insert = target < 0 ? from : target + (slot.before ? 0 : 1);
    // Use the SAME pitch as the visually docked row below; no gap can
    // disagree with the drop position even while Zen repaints the folder.
    const height = subject.dragPitch || 35;
    for (let i = 0; i < rows.length; i++) {
      const node = rows[i];
      if (node === subject.item || !node?.isConnected) continue;
      let dy = 0;
      if (from >= 0 && target >= 0) {
        if (insert < from && i >= insert && i < from) dy = height;
        else if (insert > from + 1 && i > from && i < insert) dy = -height;
      }
      if (subject.avoidOffsets.get(node) === dy) continue;
      subject.avoidOffsets.set(node, dy);
      node.style?.setProperty?.('--zsf-drag-avoid-y', dy + 'px');
    }
  }
  function clearAvoidance(subject) {
    for (const node of subject?.avoidRows || []) {
      node.removeAttribute?.('data-zsf-drag-avoid');
      node.style?.removeProperty?.('--zsf-drag-avoid-y');
    }
    subject?.avoidOffsets?.clear();
  }
  // Zia's native drag uses a captured row layout and transforms neighbours
  // into a live insertion gap, rather than moving real tabs on mousemove.
  // Draw our ONE existing drag card directly IN that gap so release and
  // preview have the same target. The DOM is untouched until native drop.
  function dockGroupPreview(subject, slot, pointerX, pointerY) {
    if (!ghost || subject?.kind !== 'group') return;
    if (!slot || !subject.avoidRows?.length) {
      ghost.removeAttribute('data-zsf-docked');
      ghost.style.removeProperty('width');
      ghost.style.removeProperty('height');
      ghost.style.removeProperty('--zsf-drag-dock-h');
      return;
    }
    const rows = subject.avoidRows;
    const from = rows.indexOf(subject.item), target = rows.indexOf(slot.target);
    if (from < 0 || target < 0) return;
    const insertion = target + (slot.before ? 0 : 1);
    const pitch = subject.dragPitch || 35;
    // Moving down: the intervening rows have already slid UP by one
    // pitch. The visible gap is just ABOVE the unshifted marker coordinate.
    // Moving up: the rows slide DOWN and the gap begins AT that marker.
    let top = slot.markerY - (insertion > from + 1 ? pitch : 0);
    if (insertion === from || insertion === from + 1) {
      top = rectOf(subject.item)?.top ?? top;
    }
    const w = Math.max(60, Math.min(slot.box.width, (window.innerWidth || 1280) - 12));
    const left = Math.max(3, Math.min(slot.box.left, (window.innerWidth || 1280) - w - 3));
    ghost.setAttribute('data-zsf-docked', 'true');
    ghost.style.left = Math.round(left) + 'px';
    ghost.style.top = Math.round(top) + 'px';
    ghost.style.width = Math.round(w) + 'px';
    ghost.style.height = Math.round(pitch) + 'px';
    ghost.style.setProperty('--zsf-drag-dock-h', Math.round(pitch) + 'px');
  }
  function slotForGroup(source, x, y, layout) {
    const delegated = ziaShim?.group === source && source?.isConnected &&
      source.matches?.(GROUP) && !source.pinned;
    if (!(ownGroup(source) || delegated) || !withinSidebar(x, y)) return null;
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
    ziaDelegate = null;
    restoreZiaShim();
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
  }
  function activate(subject, event) {
    if (active || !subject?.item?.isConnected) return;
    pending = null;
    active = subject;
    // Zen's grey bar with circular ends is the DOM drop indicator,
    // NOT the native DataTransfer drag image. Mask only our own drag.
    document.documentElement.setAttribute('data-zsf-hide-native-indicator', 'true');
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
    if (subject.kind === 'group') beginAvoidance(subject);
    update(event);
  }
  function update(event, scheduleScroll = true) {
    if (!active?.item?.isConnected || !ghost) return;
    const { x, y } = point(event);
    // Zia already owns real tab drag visuals: it moves the tab and shifts
    // neighbours with transforms, then commits its exact target on drop.
    // Do NOT hide the Zia-dragged tab with our opacity=0 override, and do
    // NOT perform a second independent move on drop. Our custom drag is
    // only needed for the Site Folders group label, which Zia doesn't
    // recognize as a zen-folder.
    const ziaOwnsTab = active.kind === 'tab' &&
      document.documentElement.hasAttribute('zia-dragging-tab');
    if (ziaOwnsTab) {
      active.delegatedToZia = true;
      active.item.removeAttribute('data-zsf-drag-member');
      ghost.hidden = true;
      if (scheduleScroll) scheduleAutoScroll(x, y);
      return;
    }
    const slot = chooseSlot(active, x, y);
    active.paintedSlot = slot;
    updateAvoidance(active, slot);
    dockGroupPreview(active, slot, x, y);
    if (active.kind !== 'group' || !slot) {
      // A member tab keeps its native Zia preview while our small card
      // reports the current target. An invalid group target falls back
      // to following the cursor, never showing a misleading occupied slot.
      const width = ghost.offsetWidth || 178;
      const height = ghost.offsetHeight || 42;
      ghost.style.left = Math.round(Math.max(6,
        Math.min(x + 15, (window.innerWidth || 1280) - width - 6))) + 'px';
      ghost.style.top = Math.round(Math.max(6,
        Math.min(y + 12, (window.innerHeight || 800) - height - 6))) + 'px';
    }
    if (scheduleScroll) scheduleAutoScroll(x, y);
    if (!slot) {
      ghost.setAttribute('data-invalid', 'true');
      ghost.querySelector('.zsf-drag-hint').textContent = '此處無法調整順序';
      return;
    }
    ghost.removeAttribute('data-invalid');
    ghost.querySelector('.zsf-drag-hint').textContent =
      '移到「' + itemName(slot.target) + '」' + (slot.before ? '上方' : '下方');

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
    stopZiaScrollBridge();
    if (autoFrame) window.cancelAnimationFrame?.(autoFrame);
    autoFrame = 0;
    autoPointer = null;
    clearAvoidance(active);
    document.documentElement.removeAttribute('data-zsf-hide-native-indicator');
    if (active?.kind === 'group')
      active.item?.removeAttribute?.('data-zsf-drag-source');
    if (active?.kind === 'tab')
      active.item?.removeAttribute?.('data-zsf-drag-member');
    active = pending = null;
    ghost?.remove();
    ghost = null;
  }
  function captureZiaGap(context) {
    const group = context.group, parent = context.parent;
    // Read the gap already painted by Zia, including its hysteresis. Do
    // not recalculate a second destination from the release coordinates.
    const rows = [...parent.children].filter(node => node === group ||
      node.localName === 'tab-group' || (isPlainTab(node) && !node.group));
    const from = rows.indexOf(group);
    let before = group.nextElementSibling;
    for (let i = 0; i < rows.length; i++) {
      const node = rows[i];
      if (node === group) continue;
      const painted = node.hasAttribute?.('zia-shift') ? node : groupLabel(node);
      const shift = painted?.hasAttribute?.('zia-shift') ?
        parseFloat(painted.style.getPropertyValue('--zia-drag-y')) || 0 : 0;
      if (i < from && shift > .5) { before = node; break; }
      if (i > from && shift < -.5) before = node.nextElementSibling;
    }
    if (before === group) before = group.nextElementSibling;
    context.landingBefore = before;
  }
  function prepareZiaLanding(context) {
    const shim = ziaShim, group = context.group, parent = context.parent;
    if (!shim || !parent?.isConnected || group.parentElement !== parent) return;
    shim.landingContext = context;
    const originalInsert = parent.insertBefore;
    const workspace = group.closest?.('zen-workspace');
    const separator = workspace?.querySelector?.('.pinned-tabs-container-separator');
    let attempted = false;
    shim.landingUndo = [];
    const valid = before => context.workspace === window.gZenWorkspaces?.activeWorkspace &&
      parent.isConnected && group.parentElement === parent && !group.pinned &&
      ![...(group.tabs || [])].some(tab => tab.pinned) &&
      (!before || (before !== group && before.isConnected && before.parentElement === parent));
    const land = () => {
      // Freeze the last PAINTED gap. Every Zia insertion branch for this
      // object uses that one gap, including its native-API/DOM fallback.
      if (!context.accepted || attempted) return group;
      attempted = true;
      const before = context.landingBefore;
      if (!valid(before)) return group; // Cancel in place; never correct later.
      if (group.nextElementSibling !== before) {
        // Zia has already pinned its landing row at the release position.
        // Preserve that visual position across the single DOM insertion;
        // its existing repin/glide callback still owns the landing motion.
        const held = group.hasAttribute?.('zia-landing') &&
          group.getBoundingClientRect?.();
        originalInsert.call(parent, group, before || null);
        if (held && group.style) {
          group.style.removeProperty('transform');
          const at = group.getBoundingClientRect();
          group.style.setProperty('transform',
            `translate(${held.left - at.left}px, ${held.top - at.top}px)`, 'important');
        }
      }
      return group;
    };
    // Commit before this drop dispatch can paint cleared preview offsets.
    // Zia's queued placement reaches the same one-shot guard and is a no-op.
    context.commitNativeLanding = land;
    const wrap = (host, key, intercept) => {
      if (!host || typeof host[key] !== 'function') return;
      const descriptor = Object.getOwnPropertyDescriptor(host, key);
      if (descriptor && !descriptor.configurable) throw new Error('Unwrappable landing API');
      const original = host[key];
      const wrapped = function(node, ...args) {
        return node === group ? intercept(...args) : original.call(this, node, ...args);
      };
      Object.defineProperty(host, key, {configurable:true, writable:true, value:wrapped});
      shim.landingUndo.push(() => {
        if (host[key] !== wrapped) return;
        if (descriptor) Object.defineProperty(host, key, descriptor);
        else delete host[key];
      });
    };
    try {
      // Scoped to this exact group; ordinary tabs and other mods are unchanged.
      for (const host of new Set([parent, separator?.parentNode]))
        wrap(host, 'insertBefore', land);
      wrap(window.gBrowser, 'moveTabBefore', land);
      wrap(window.gBrowser, 'moveTabAfter', land);
      // canNest() rejects inside previews, but Zia's queued finish can
      // still carry an inside target. Guard its DOM fallback paths too:
      // empty-folder appendChild, open-folder insertBefore and row.after.
      // Every path uses the same accepted painted gap, never a later repair.
      const folders = workspace?.querySelectorAll?.(
        'zen-folder, tab-group:not([split-view-group])') || [];
      for (const folder of folders) {
        const box = folder.querySelector?.(':scope > .tab-group-container');
        for (const host of new Set([folder, box].filter(Boolean))) {
          wrap(host, 'insertBefore', land);
          wrap(host, 'appendChild', land);
          for (const row of [...(host.children || [])]) {
            wrap(row, 'before', land);
            wrap(row, 'after', land);
          }
        }
      }
    } catch (error) {
      for (const undo of shim.landingUndo.reverse()) undo();
      shim.landingUndo = [];
      throw error;
    }
  }
  function finish(event) {
    if (ziaDelegate?.kind === 'tab') {
      releaseZiaAfterDrop();
      return; // Native tab drops, scroll and landing remain entirely Zia's.
    }
    if (ziaDelegate) {
      // Zia's folder path inserts before the pinned separator for a
      // below-separator drop. Accept the guarded insertion before Zia measures
      // its landing animation, rather than moving it back in a later task.
      // Zia can clear painted shifts in its drop listeners. Keep the gap
      // captured after its last dragover; do not recalculate during drop.
      ziaDelegate.accepted = ziaDelegate.previewAllowed === true;
      ziaDelegate.commitNativeLanding?.();
      event.preventDefault?.();
      event.stopPropagation?.();
      pending = null;
      releaseZiaAfterDrop();
      return;
    }
    if (!active) { pending = null; restoreZiaShim(); return; }
    // The final release uses the SAME measured slot as the last visual
    // dock, unless the pointer has moved or the slot is no longer valid.
    const pointNow = point(event);
    const releaseSlot = chooseSlot(active, pointNow.x, pointNow.y);
    const paintedSlot = active.paintedSlot;
    const slot = releaseSlot && paintedSlot &&
      releaseSlot.target === paintedSlot.target && releaseSlot.before === paintedSlot.before
      ? paintedSlot : null;
    const context = active;
    restoreZiaShim();
    if (context.delegatedToZia) {
      reset();
      return; // Zia is the single writer of the actual tab order.
    }
    const docked = slot && context.kind === 'group' &&
      ghost?.hasAttribute?.('data-zsf-docked') ? ghost : null;
    if (docked) ghost = null; // keep ONE preview visible during landing
    reset();
    if (!slot) { docked?.remove(); return; }
    if (docked) {
      // The original label remains invisible until its native DOM move
      // reaches the exact insertion slot seen during the gesture.
      context.item.setAttribute('data-zsf-drag-source', 'true');
      docked.setAttribute('data-zsf-landing', 'true');
    }
    const token = generation;
    const task = { done: null };
    const endLanding = () => {
      if (docked) {
        context.item?.removeAttribute?.('data-zsf-drag-source');
        docked.remove();
      }
    };
    // The landing card is a frame bridge, NOT a wait before committing.
    // Never retain it for Zen's full 4-second animation-idle timeout.
    const landingTimeout = docked ? setTimeout(endLanding, 80) : null;
    task.done = (async () => {
      const valid = () => !destroyed && generation === token &&
        window.gZenWorkspaces?.activeWorkspace === context.workspace;
      await Promise.resolve(); // finish DOM drop dispatch, at most one tick
      if (!valid()) return;
      commit(slot, context);
      // One accepted placement only. Never wait and reorder a second time.
    })().finally(() => {
      if (landingTimeout !== null) clearTimeout(landingTimeout);
      endLanding();
      tasks.delete(task);
    });
    tasks.add(task);
  }

  function onDown(event) {
    if (event.button !== 0) return;
    stopZiaScrollBridge();
    restoreZiaShim(); ziaDelegate = null;
    const source = sourceFromEvent(event);
    generation++;
    const port = source ? findScrollPort(source) : null;
    pending = source ? { ...source, x: event.clientX, y: event.clientY,
      workspace: window.gZenWorkspaces?.activeWorkspace,
      scrollPort: port, scrolls: captureScrolls(event, port),
      layout: captureLayout(source), root: source.parent.parentElement,
      collapsed: source.parent.collapsed } : null;
    // Prepare recognition regardless of event provenance. Ownership is
    // established only by dragstart and Zia's actual running state.
    if (source?.kind === 'group') primeZiaShim(source);
    if (source && window.__ziaLoaded === true) {
      // Zia installs its drag listeners during deferred startup. Script
      // load order therefore does not guarantee capture-listener order.
      // Run handoff after Zia, and queue cleanup AFTER its landing job.
      for (const [type, handler] of [['dragstart', onStart], ['dragover', onOver], ['drop', finish]]) {
        window.removeEventListener(type, handler, true);
        window.addEventListener(type, handler, true);
      }
    }
  }
  function onMove(event) {
    if (ziaDelegate || window.__ziaLoaded === true) return;
    // With Zia loaded, wait for native dragstart. Never hide a source or
    // create a competing card/scroll controller before native takeover.
    if (!active) {
      if (!pending) return;
      if (!(event.buttons & 1)) {
        pending = null;
        restoreZiaShim();
        return;
      }
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < THRESHOLD)
        return;
      // No native dragstart has claimed this gesture. Paint the fallback
      // now, retaining recognition for a later native dragstart takeover.
      activate(pending, event);
    } else if (event.buttons & 1) update(event);
  }
  function onStart(event) {
    // onDown orders this handler after Zia's deferred capture listeners.
    const path = event.composedPath?.() || [];
    if (ziaShim && ziaIsDragging() &&
        (path.includes(ziaShim.group) ||
         ziaShim.group.contains?.(event.target))) {
      const context = pending || active;
      if (active) reset();
      ziaDelegate = ziaShim.landingContext;
      Object.assign(ziaDelegate, { item: ziaShim.group, kind: 'group',
        layout: context?.layout || captureLayout({kind:'group',item:ziaShim.group}),
        scrolls: context?.scrolls || [], scrollPort: context?.scrollPort || findScrollPort({item:ziaShim.group}) });
      pending = null;
      installZiaScrollBridge(ziaDelegate);
      return;
    }
    if (window.__ziaLoaded === true && sourceFromEvent(event)?.kind === 'group') {
      event.preventDefault?.();
      pending = null;
      restoreZiaShim();
      return;
    }
    if (ziaShim) restoreZiaShim();
    const source = pending?.item?.isConnected ? pending :
      active?.item?.isConnected ? active : sourceFromEvent(event);
    if (source && !source.layout) {
      source.layout = captureLayout(source);
      source.workspace = window.gZenWorkspaces?.activeWorkspace;
      source.scrollPort = findScrollPort(source);
      source.scrolls = captureScrolls(event, source.scrollPort);
      source.root = source.parent?.parentElement;
      source.collapsed = source.parent?.collapsed;
    }
    if (source?.kind === 'tab' && (window.__ziaLoaded === true || ziaIsDragging())) {
      // A pointer preview may already exist. Clear its source opacity,
      // blank image and edge-scroll loop during dragstart, not on the
      // next dragover (which scrolling need not deliver).
      reset();
      if (ziaIsDragging()) {
        ziaDelegate = { ...source, kind: 'tab', item: source.item,
          workspace: window.gZenWorkspaces?.activeWorkspace,
          scrollPort: source.scrollPort || findScrollPort(source) };
        installZiaScrollBridge(ziaDelegate);
      }
      return;
    }
    if (source) {
      activate(source, event);
      if (active) active.native = true;
    }
  }
  function onOver(event) {
    if (ziaDelegate?.kind === 'tab') {
      scheduleAutoScroll(event.clientX, event.clientY);
      return;
    }
    if (ziaDelegate) {
      captureZiaGap(ziaDelegate);
      const {x, y} = point(event);
      const nav = document.getElementById('navigator-toolbox')?.getBoundingClientRect?.();
      const separator = ziaDelegate.group.closest?.('zen-workspace')
        ?.querySelector?.('.pinned-tabs-container-separator')?.getBoundingClientRect?.();
      ziaDelegate.previewAllowed = !!nav && !!separator &&
        x >= nav.left && x <= nav.right && y >= separator.bottom && y <= nav.bottom;
      scheduleAutoScroll(x, y);
      // Let native dragover reach Zen. The edge assist yields to existing
      // native scrolling; Zia keeps ownership of the preview and ordering.
      // The scoped landing guards keep premature native insertions in place.
      return;
    }
    if (active) update(event);
  }
  function hideNativeDragImage(event) {
    if (ziaDelegate) return; // Zia already blanks its native drag image.
    // Window bubble phase runs after native dragstart handlers. Keep the
    // real DataTransfer/drop events; suppress only the OS ghost picture.
    if (!active?.item?.isConnected || !event.dataTransfer?.setDragImage)
      return;
    const fromEvent = sourceFromEvent(event);
    if (fromEvent?.item !== active.item) return;
    try {
      if (!nativeBlank) {
        nativeBlank = create('div', 'zsf-native-blank-drag');
        nativeBlank.style.cssText =
          'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
        document.documentElement.appendChild(nativeBlank);
      }
      event.dataTransfer.setDragImage(nativeBlank, 0, 0);
    } catch (error) {
      console.warn('[ZenSiteFoldersDrag] Native preview unavailable:', error);
    }
  }
  function onKey(event) {
    if (event.key === 'Escape') {
      generation++; ziaDelegate = null; restoreZiaShim(); reset();
    }
  }
  function start() {
    if (started || destroyed) return;
    const tabs = document.getElementById('tabbrowser-tabs');
    if (!tabs) return;
    started = true;
    bind(tabs, 'mousedown', onDown, true);
    bind(window, 'mousemove', onMove, true);
    bind(window, 'dragstart', onStart, true);
    bind(window, 'dragstart', hideNativeDragImage, false);
    bind(window, 'dragover', onOver, true);
    bind(window, 'drop', finish, true);
    // Zia's pointer-only drag can end with mouseup and no native DOM drop.
    // Commit the displayed valid slot immediately instead of merely
    // resetting our preview; native OS drag keeps its separate drop path.
    bind(window, 'mouseup', event => {
      if (ziaDelegate) return; // Wait for Zia's native drop.
      if (active && !active.native) finish(event);
      else if (!active) { pending = null; restoreZiaShim(); }
    }, true);
    bind(window, 'dragend', () => {
      if (ziaDelegate) releaseZiaAfterDrop();
      else if (!ziaCleanupTimer) restoreZiaShim();
      // After a native drop, Zia's setTimeout(0) finishFolderDrop still
      // needs the temporary identity. Do not clear it on dragend earlier
      // than the deferred cleanup already scheduled after Zia's drop task.
      reset();
    }, true);
    // Tab switching focuses the content browser and emits a window blur too.
    // Only OS-window deactivation cancels the gesture; descendant/content
    // focus changes must not erase the source captured on mousedown.
    bind(window, 'deactivate', () => {
      generation++; ziaDelegate = null; restoreZiaShim(); reset();
    }, true);
    bind(window, 'keydown', onKey, true);
    bind(window, 'ZenWorkspacesUIUpdate', () => {
      const workspace = window.gZenWorkspaces?.activeWorkspace;
      if (workspace !== lastWorkspace) {
        generation++; ziaDelegate = null; restoreZiaShim(); reset();
      }
      lastWorkspace = workspace;
    });
    bind(window, 'mousedown', () => { generation++; }, true);
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    ziaDelegate = null;
    restoreZiaShim();
    reset();
    nativeBlank?.remove();
    nativeBlank = null;
    generation++;
    for (const [node, name, fn, opts] of listeners)
      try { node.removeEventListener(name, fn, opts); } catch (_) {}
    listeners.length = 0;
    if (window.__zsfDragV037 === api) delete window.__zsfDragV037;
  }
  const api = { start, destroy, version: '0.6.1', chooseSlot, commit,
    beforeMutation, nativeIdle,
    // Explicit probe for isolated native Zen+Zia regression tests.
    prepareZiaGroupDrag(group) {
      return primeZiaShim({ kind: 'group', item: group });
    },
    debugDrag(group) {
      return { activeKind: active?.kind || null, pendingKind: pending?.kind || null,
        ziaDelegate: !!ziaDelegate, ziaShim: !!ziaShim,
        groupIsZenFolder: !!group?.isZenFolder, ownGroup: ownGroup(group),
        rootZia: ziaIsDragging(), ghost: !!ghost?.isConnected };
    }
  };
  window.__zsfDragV037 = api;
  if (document.readyState === 'complete') start();
  else bind(window, 'load', start, { once: true });
  bind(window, 'unload', destroy, { once: true });
})();
