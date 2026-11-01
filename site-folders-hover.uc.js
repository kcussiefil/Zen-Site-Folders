// ==UserScript==
// @name         Zen Site Folders — ordinary group hover cards
// @version      0.3.2
// @description  Read-only Zia-style hover list for unpinned Zen Site Folders groups.
// @include      chrome://browser/content/browser.xhtml
// ==/UserScript==
(() => {
  'use strict';
  if (window.__zsfGroupHoverV032) return;
  window.__zsfGroupHoverV032 = true;

  const TAG = '[ZenSiteFoldersHover]';
  const XHTML_NS = 'http://www.w3.org/1999/xhtml';
  const GROUP_SELECTOR = 'tab-group[data-zsf-site]:not([split-view-group])';
  const HOVER_DELAY_MS = 105;
  const HIDE_DELAY_MS = 120;
  const EXIT_MS = 120;
  const GAP = 8;
  let card = null;
  let activeGroup = null;
  let activeLabel = null;
  let openTimer = null;
  let closeTimer = null;
  let exitTimer = null;
  let pendingLabel = null;
  let started = false;
  let destroyed = false;
  let hoverHost = null;
  const handlers = [];

  function bind(target, type, handler, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler, options);
    handlers.push([target, type, handler, options]);
  }

  function clearOpen() {
    if (openTimer != null) clearTimeout(openTimer);
    openTimer = null;
    pendingLabel = null;
  }
  function clearClose() {
    if (closeTimer != null) clearTimeout(closeTimer);
    closeTimer = null;
    if (exitTimer != null) clearTimeout(exitTimer);
    exitTimer = null;
    card?.removeAttribute?.('data-closing');
  }

  function groupAt(target) {
    const label = target?.closest?.('.tab-group-label-container');
    const group = label?.parentElement;
    if (!group || !group.matches?.(GROUP_SELECTOR) || !group.isConnected) return null;
    if (!group.collapsed && !group.hasAttribute('collapsed')) return null;
    if (!group.closest?.('zen-workspace')) return null;
    return { group, label };
  }

  function members(group) {
    // Do not touch hidden synthetic Zen tabs, split views, cloned rows, or
    // unrelated Zia/Advanced Tab Groups. This is read-only enumeration.
    const list = Array.from(group.tabs || group.querySelectorAll(':scope > .tab-group-container > tab'));
    return list.filter(tab => tab?.isConnected && tab.group === group &&
      !tab.hasAttribute('zen-empty-tab') && !tab.hasAttribute('cloned') &&
      !tab.closing && !tab.hidden);
  }

  function el(type, className, text) {
    const node = document.createElementNS(XHTML_NS, type);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function ensureCard() {
    if (card?.isConnected) return card;
    card = el('div', 'zsf-hover-card');
    card.id = 'zsf-folder-hover-card';
    card.hidden = true;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', '資料夾分頁快速預覽');
    const list = el('div', 'zia-folder-card-list zsf-hover-list');
    list.setAttribute('role', 'list');
    card.appendChild(list);
    card.addEventListener('mouseenter', clearClose);
    card.addEventListener('mouseleave', scheduleClose);
    card.addEventListener('click', onCardClick);
    card.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target?.closest?.('.zsf-hover-row');
      if (!row) return;
      event.preventDefault();
      row.click();
    });
    document.documentElement.appendChild(card);
    return card;
  }

  function makeRow(tab) {
    const row = el('div', 'zia-folder-card-row zsf-hover-row');
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.zsfTab = tab;
    if (tab.selected) { row.setAttribute('zia-selected', 'true'); row.setAttribute('data-selected', 'true'); }
    const icon = el('img', 'zia-folder-card-icon zsf-hover-icon');
    try {
      icon.src = window.gBrowser?.getIcon?.(tab) ||
        tab.querySelector('.tab-icon-image')?.getAttribute('src') ||
        'chrome://global/skin/icons/defaultFavicon.svg';
    } catch (_) {
      icon.src = 'chrome://global/skin/icons/defaultFavicon.svg';
    }
    icon.setAttribute('aria-hidden', 'true');
    const title = el('span', 'zia-folder-card-label zsf-hover-title', tab.label || '新分頁');
    row.setAttribute('aria-label', title.textContent);
    row.append(icon);
    if (tab.hasAttribute('soundplaying') || tab.hasAttribute('muted')) {
      const muted = tab.hasAttribute('muted');
      const mute = el('img', 'zia-folder-card-sound zia-folder-card-act zsf-hover-action');
      mute.src = 'chrome://sine/content/zia/icons/ui/' + (muted ? 'volume-off' : 'volume') + '.svg';
      mute.setAttribute('zia-act', 'mute');
      mute.setAttribute('title', muted ? '取消靜音' : '靜音');
      row.appendChild(mute);
    }
    row.appendChild(title);
    const close = el('img', 'zia-folder-card-act zsf-hover-action');
    close.src = 'chrome://sine/content/zia/icons/ui/x.svg';
    close.setAttribute('zia-act', 'close');
    close.setAttribute('title', '關閉分頁');
    row.appendChild(close);
    return row;
  }

  function render(group) {
    const popup = ensureCard();
    const list = popup.querySelector('.zsf-hover-list');
    if (!list) return false;
    const inset = tabEdgeInset();
    if (inset) list.style.setProperty('--zia-folder-card-inset', inset + 'px');
    else list.style.removeProperty('--zia-folder-card-inset');
    const tabs = members(group);
    if (!tabs.length) return false;
    const scrollTop = activeGroup === group ? (list.scrollTop || 0) : 0;
    const rows = tabs.map(makeRow);
    const add = el('div', 'zia-folder-card-row zsf-hover-row zsf-hover-new');
    add.setAttribute('zia-new-tab', 'true');
    add.setAttribute('role', 'button');
    add.setAttribute('tabindex', '0');
    add.setAttribute('aria-label', '在資料夾內開啟新分頁');
    add.dataset.action = 'new';
    const plus = el('img', 'zia-folder-card-icon zsf-hover-icon');
    plus.src = 'chrome://sine/content/zia/icons/ui/plus.svg';
    plus.setAttribute('aria-hidden', 'true');
    add.append(plus, el('span', 'zia-folder-card-label zsf-hover-title', '開啟新分頁'));
    rows.push(add);
    list.replaceChildren(...rows);
    list.scrollTop = scrollTop;
    return true;
  }

  // Zia measures the sidebar icon inset rather than assuming a fixed padding.
  // Use the exact same inset for the speaker, favicon and label alignment.
  function tabEdgeInset() {
    try {
      const tabs = window.gBrowser?.visibleTabs || window.gBrowser?.tabs || [];
      const tab = [...tabs].find(item => !item.pinned &&
        !item.hasAttribute?.('zen-essential') && item.getBoundingClientRect?.().width);
      const edge = tab?.querySelector?.('.tab-background')?.getBoundingClientRect?.();
      const icon = ['.tab-icon-image', '.tab-icon-stack']
        .map(query => tab?.querySelector?.(query)?.getBoundingClientRect?.())
        .find(box => box?.width);
      const inset = edge && icon?.width ?
        Math.round((icon.left - edge.left) * 2) / 2 : 0;
      return inset >= 4 && inset <= 16 ? inset : 0;
    } catch (_) {
      return 0;
    }
  }

  // Use LAYOUT dimensions (offsetHeight/offsetWidth), never transformed
  // getBoundingClientRect values while the 0.7→1 Zia animation is running.
  // Otherwise the calculated card is too short and its bottom can escape.
  function position(label) {
    const popup = ensureCard();
    const anchor = label.getBoundingClientRect();
    const sidebar = document.getElementById('navigator-toolbox')?.getBoundingClientRect() || anchor;
    const root = document.documentElement;
    const onRight = root.getAttribute('zen-right-side') === 'true';
    const viewportW = window.innerWidth || root.clientWidth || 1200;
    const viewportH = window.innerHeight || root.clientHeight || 800;
    const list = popup.querySelector('.zsf-hover-list');
    const available = Math.max(64, viewportH - 16);
    // Keep the row list scrollable to its very last "New Tab" entry even
    // when the group header is near the bottom of a short window.
    popup.style.maxHeight = available + 'px';
    if (list) list.style.maxHeight = available + 'px';
    const width = popup.offsetWidth || 222;
    const height = Math.min(popup.offsetHeight || 60, available);
    let x = onRight ? sidebar.left - width - GAP : sidebar.right + GAP;
    x = Math.max(8, Math.min(x, viewportW - width - 8));
    const first = popup.querySelector('.zsf-hover-row');
    const middle = first ? first.offsetTop + first.offsetHeight / 2 : height / 2;
    const anchorY = anchor.top + anchor.height / 2;
    const y = Math.max(8, Math.min(anchorY - middle, viewportH - height - 8));
    popup.style.left = Math.round(x) + 'px';
    popup.style.top = Math.round(y) + 'px';
    popup.style.transformOrigin = (onRight ? 'right' : 'left') + ' ' +
      Math.round(anchorY - y) + 'px';
  }

  function closeNow() {
    clearOpen();
    clearClose();
    if (card) {
      card.hidden = true;
      card.removeAttribute('data-open');
      card.removeAttribute('data-snap');
      card.removeAttribute('data-closing');
    }
    activeGroup = null;
    activeLabel = null;
  }

  function scheduleClose() {
    clearOpen();
    clearClose();
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (!card || card.hidden) { closeNow(); return; }
      if (activeLabel?.matches?.(':hover') || card.matches?.(':hover')) return;
      card.removeAttribute('data-open');
      card.setAttribute('data-closing', 'true');
      exitTimer = setTimeout(closeNow, EXIT_MS);
    }, HIDE_DELAY_MS);
  }

  function open(group, label) {
    if (destroyed || !group?.isConnected || !label?.isConnected ||
        (!group.collapsed && !group.hasAttribute('collapsed'))) return;
    const wasUp = card?.isConnected && !card.hidden && !card.hasAttribute('data-closing');
    clearOpen();
    clearClose();
    if (!render(group)) return;
    activeGroup = group;
    activeLabel = label;
    card.hidden = false;
    card.removeAttribute('data-open');
    position(label);
    if (wasUp) {
      card.setAttribute('data-snap', 'true');
    } else {
      card.removeAttribute('data-snap');
      // Restart the Zia-style 260ms spring on EVERY new appearance.
      void card.offsetWidth;
      card.setAttribute('data-open', 'true');
    }
  }

  function onCardClick(event) {
    const row = event.target?.closest?.('.zsf-hover-row');
    const group = activeGroup;
    if (!row || !group?.isConnected) return;
    event.stopPropagation();
    const action = event.target?.closest?.('.zsf-hover-action')?.getAttribute?.('zia-act');
    if (action) {
      const tab = row.zsfTab;
      if (!tab?.isConnected || tab.group !== group) return;
      try {
        if (action === 'mute') {
          tab.toggleMuteAudio?.();
        } else if (action === 'close') {
          window.gBrowser?.removeTab?.(tab, { animate: true });
        } else {
          return;
        }
      } catch (error) {
        console.warn(TAG, 'Explicit card action failed:', action, error);
      }
      // Preserve list scroll position across explicit close/mute actions.
      setTimeout(() => {
        if (!activeGroup?.isConnected || !card || card.hidden) return;
        if (render(activeGroup)) position(activeLabel);
        else closeNow();
      }, 80);
      return;
    }
    if (row.dataset.action === 'new') {
      // A deliberate click only. Do not pin a newly created tab.
      try {
        const browser = window.gBrowser;
        if (typeof browser?.addTrustedTab !== 'function' ||
            typeof browser?.moveTabToExistingGroup !== 'function') {
          throw new Error('Zen lacks ordinary group tab API');
        }
        const previousTop = members(group)[0] || null;
        const tab = browser.addTrustedTab('about:newtab', { relatedToCurrent: false });
        if (!tab?.isConnected || tab.pinned) throw new Error('New tab was not ordinary');
        browser.moveTabToExistingGroup(tab, group);
        if (tab.group !== group) throw new Error('Could not add new tab to group');
        // A newly created member is newest: insert at the top, but do not
        // reposition the group itself or turn the tab into a pinned tab.
        if (previousTop?.isConnected && previousTop.group === group &&
            typeof browser.moveTabBefore === 'function') {
          browser.moveTabBefore(tab, previousTop);
        }
        browser.selectedTab = tab;
      } catch (error) {
        console.warn(TAG, 'New tab in ordinary group unavailable:', error);
      }
      closeNow();
      return;
    }
    const tab = row.zsfTab;
    if (tab?.isConnected && tab.group === group) {
      window.gBrowser.selectedTab = tab;
    }
    closeNow();
  }

  function onMouseOver(event) {
    if (destroyed || event.target?.closest?.('#zsf-folder-hover-card')) return;
    const target = groupAt(event.target);
    if (!target) return;
    clearClose();
    if (activeGroup === target.group && card && !card.hidden) return;
    // Moving over nested label/icon nodes emits multiple mouseover events.
    // Never restart the delay for the same pending folder.
    if (pendingLabel === target.label && openTimer != null) return;
    const alreadyUp = !!(card?.isConnected && !card.hidden);
    clearOpen();
    if (alreadyUp) { open(target.group, target.label); return; }
    pendingLabel = target.label;
    openTimer = setTimeout(() => {
      openTimer = null;
      pendingLabel = null;
      if (target.label.isConnected && target.label.matches(':hover')) {
        open(target.group, target.label);
      }
    }, HOVER_DELAY_MS);
  }

  function onMouseOut(event) {
    const label = event.target?.closest?.('.tab-group-label-container');
    if (!label) return;
    const next = event.relatedTarget;
    if (next && (label.contains(next) || card?.contains(next))) return;
    if (label === activeLabel || groupAt(label)) scheduleClose();
  }

  function start() {
    if (started || destroyed) return;
    const toolbox = document.getElementById('navigator-toolbox');
    const tabContainer = window.gBrowser?.tabContainer;
    if (!toolbox || !tabContainer) return false;
    started = true;
    hoverHost = toolbox;
    bind(toolbox, 'mouseover', onMouseOver);
    bind(toolbox, 'mouseout', onMouseOut);
    bind(toolbox, 'wheel', event => {
      // Scrolling the card must not close it; sidebar scrolling may.
      if (card?.contains?.(event.target)) return;
      closeNow();
    }, { passive: true, capture: true });
    bind(toolbox, 'mousedown', closeNow, true);
    bind(tabContainer, 'TabGroupExpand', closeNow);
    bind(window, 'TabSelect', () => {
      if (activeGroup?.isConnected && activeLabel?.isConnected && card && !card.hidden) {
        if (render(activeGroup)) position(activeLabel);
        else closeNow();
      }
    });
    bind(tabContainer, 'TabClose', () => {
      if (activeGroup?.isConnected && activeLabel?.isConnected) {
        if (render(activeGroup)) position(activeLabel);
        else closeNow();
      }
    });
    bind(window, 'blur', closeNow);
    bind(window, 'resize', closeNow);
    bind(window, 'ZenWorkspacesUIUpdate', closeNow);
    return true;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    closeNow();
    for (const [target, type, handler, options] of handlers) {
      try { target.removeEventListener(type, handler, options); } catch (_) {}
    }
    handlers.length = 0;
    card?.remove();
    card = null;
    if (window.__zsfGroupHoverV032 === api) delete window.__zsfGroupHoverV032;
  }
  const api = { start, destroy, closeNow, position, version: '0.3.2' };
  window.__zsfGroupHoverV032 = api;
  if (document.readyState === 'complete') {
    if (!start()) window.addEventListener('load', start, { once: true });
  } else {
    window.addEventListener('load', start, { once: true });
  }
  window.addEventListener('unload', destroy, { once: true });
})();
