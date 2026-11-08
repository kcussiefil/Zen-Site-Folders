// ==UserScript==
// @name         Zen Site Folders — 繁體中文群組選單
// @version      0.7.7
// @description  Scoped native context menu for ordinary site groups.
// @include      chrome://browser/content/browser.xhtml
// ==/UserScript==
(() => {
  'use strict';
  if (window.__zsfMenuV037) return;
  const TAG = '[ZenSiteFoldersMenu]';
  const SNAPSHOT_KEY = 'zsf-before-sort-v1';
  const ARCHIVE_KEY = 'zsf-archived-snapshots-v1';
  const ICONS_KEY = 'zsf-custom-icons-v1';
  const GROUP_SELECTOR = 'tab-group[data-zsf-site]:not([split-view-group])';
  const COLOR_PREF = 'zsf.selected-tab-color.v1';
  const COLOR_TOPIC = 'zsf-selected-tab-color-changed';
  const DEFAULT_COLOR = { hex: '#ffffff', alpha: 8 };
  let colorDialog = null, tabColorItem = null;
  function validColor(value) {
    return value && /^#[0-9a-f]{6}$/i.test(value.hex) &&
      Number.isFinite(value.alpha) && value.alpha >= 0 && value.alpha <= 100;
  }
  function readColor() {
    try {
      const value = JSON.parse(Services.prefs.getStringPref(COLOR_PREF, 'null'));
      if (validColor(value)) return value;
    } catch (_) {}
    return { ...DEFAULT_COLOR };
  }
  function applySelectedColor(value = readColor()) {
    if (!validColor(value)) return;
    const rgb = [1, 3, 5].map(i => parseInt(value.hex.slice(i, i + 2), 16));
    document.documentElement.style.setProperty('--zsf-selected-tab-fill',
      `rgba(${rgb.join(', ')}, ${value.alpha / 100})`);
  }
  function chooseSelectedColor(anchorTab = null) {
    if (colorDialog?.isConnected) { colorDialog.focus(); return; }
    const html = (tag, text) => {
      const node = document.createElementNS('http://www.w3.org/1999/xhtml', tag);
      if (text != null) node.textContent = text;
      return node;
    };
    const dialog = html('dialog'); dialog.id = 'zsf-color-dialog';
    dialog.setAttribute('aria-labelledby', 'zsf-color-heading');
    const header = html('div'); header.className = 'zsf-color-heading-row';
    const heading = html('h3', '選取分頁顏色'); heading.id = 'zsf-color-heading';
    const dismiss = html('button', '×'); dismiss.type = 'button';
    dismiss.className = 'zsf-color-dismiss'; dismiss.setAttribute('aria-label', '關閉顏色設定');
    header.append(heading, dismiss);
    const colorRow = html('label'); colorRow.className = 'zsf-color-picker-row';
    const controls = html('span'); controls.className = 'zsf-color-picker-controls';
    const color = html('input'); color.type = 'color';
    color.setAttribute('aria-label', '選取分頁顏色');
    const code = html('span'); code.className = 'zsf-color-hex';
    controls.append(color, code); colorRow.append(html('span', '顏色'), controls);
    const alphaBlock = html('div'); alphaBlock.className = 'zsf-color-opacity';
    const alphaHeader = html('div'); alphaHeader.className = 'zsf-color-opacity-heading';
    const output = html('output'); output.className = 'zsf-color-percent';
    alphaHeader.append(html('span', '不透明度'), output);
    const alpha = html('input'); alpha.type = 'range'; alpha.min = '0'; alpha.max = '100';
    alpha.step = '1'; alpha.setAttribute('aria-label', '底色不透明度');
    alphaBlock.append(alphaHeader, alpha);
    const sample = html('div'); sample.className = 'zsf-color-sample';
    const caption = html('span', '即時預覽'); caption.className = 'zsf-color-sample-caption';
    const sampleTab = html('div'); sampleTab.className = 'zsf-color-sample-tab';
    sampleTab.append(html('span', anchorTab?.label || window.gBrowser?.selectedTab?.label || '目前選取的分頁'));
    sample.append(caption, sampleTab);
    const actions = html('div'); actions.className = 'zsf-color-actions';
    const button = (text, type) => {
      const node = html('button', text); node.type = 'button';
      node.className = 'zsf-color-button ' + type; return node;
    };
    const reset = button('還原預設', 'zsf-color-reset');
    const cancel = button('取消', 'zsf-color-cancel');
    const save = button('儲存', 'zsf-color-save');
    const right = html('div'); right.className = 'zsf-color-confirm'; right.append(cancel, save);
    actions.append(reset, right); dialog.append(header, colorRow, alphaBlock, sample, actions);
    const preview = () => {
      code.textContent = color.value.toUpperCase();
      output.textContent = alpha.value + '%';
      applySelectedColor({ hex: color.value, alpha: Number(alpha.value) });
    };
    const set = value => { color.value = value.hex; alpha.value = String(value.alpha); preview(); };
    set(readColor());
    color.addEventListener('input', preview);
    alpha.addEventListener('input', preview);
    reset.addEventListener('click', () => set(DEFAULT_COLOR));
    dismiss.addEventListener('click', () => dialog.close());
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); dialog.close(); }
    });
    save.addEventListener('click', () => {
      const value = { hex: color.value, alpha: Number(alpha.value) };
      if (!validColor(value)) return;
      try {
        Services.prefs.setStringPref(COLOR_PREF, JSON.stringify(value));
        Services.obs.notifyObservers(null, COLOR_TOPIC);
        dialog.close();
      } catch (_) { alertUser('無法儲存顏色，請再試一次。'); }
    });
    const toolbox = document.getElementById('navigator-toolbox');
    // Independent of preview cards: neither holder can release the other's sidebar.
    toolbox?.setAttribute('data-zsf-color-sidebar-hold', 'true');
    const position = () => {
      const sidebar = toolbox?.getBoundingClientRect();
      const anchor = anchorTab?.isConnected ? anchorTab.getBoundingClientRect() : null;
      const root = document.documentElement;
      const vw = window.innerWidth || root.clientWidth || 1024;
      const vh = window.innerHeight || root.clientHeight || 768;
      const width = dialog.getBoundingClientRect().width || 310;
      const height = dialog.getBoundingClientRect().height || 260;
      const onRight = root.getAttribute('zen-right-side') === 'true';
      const x = onRight ? (sidebar?.left ?? vw) - width - 8 : (sidebar?.right ?? 0) + 8;
      const y = anchor?.height ? anchor.top : (sidebar?.top ?? 8) + 20;
      dialog.style.left = Math.round(Math.max(8, Math.min(x, vw - width - 8))) + 'px';
      dialog.style.top = Math.round(Math.max(8, Math.min(y, vh - height - 8))) + 'px';
      dialog.style.visibility = 'visible';
    };
    dialog.addEventListener('close', () => {
      window.removeEventListener('resize', position);
      toolbox?.removeAttribute('data-zsf-color-sidebar-hold');
      applySelectedColor(); dialog.remove();
      if (colorDialog === dialog) colorDialog = null;
    }, { once: true });
    document.documentElement.appendChild(dialog); colorDialog = dialog;
    dialog.style.visibility = 'hidden';
    dialog.show(); // Non-modal, so the selected tab remains visible during adjustments.
    position(); window.addEventListener('resize', position);
  }
  const colorObserver = { observe() { applySelectedColor(); } };
  let menu = null;
  let activeGroup = null;
  let initialized = false;
  let dead = false;
  let store = null;
  let observer = null;
  const listeners = [];

  try {
    store = window.SessionStore ||
      ChromeUtils.importESModule('resource:///modules/sessionstore/SessionStore.sys.mjs').SessionStore;
  } catch (error) {
    console.warn(TAG, 'SessionStore unavailable', error);
  }

  function bind(node, type, callback, capture) {
    node?.addEventListener?.(type, callback, capture);
    listeners.push([node, type, callback, capture]);
  }

  function read(key) {
    try {
      const raw = store?.getCustomWindowValue?.(window, key);
      if (!raw) return {};
      const data = JSON.parse(raw);
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (error) {
      console.warn(TAG, 'Invalid stored map', key, error);
      return null;
    }
  }

  function write(key, object) {
    if (!store?.getCustomWindowValue || !store?.setCustomWindowValue) return false;
    try {
      const payload = JSON.stringify(object);
      store.setCustomWindowValue(window, key, payload);
      return store.getCustomWindowValue(window, key) === payload;
    } catch (error) {
      console.warn(TAG, 'Persist failed', key, error);
      return false;
    }
  }

  function currentSpace() { return window.gZenWorkspaces?.activeWorkspace || null; }

  function validGroup(group) {
    return group?.isConnected && group.matches?.(GROUP_SELECTOR) &&
      !group.closest?.('zen-library, zen-library-spaces-section') &&
      !group.hasAttribute('cloned') && !group.id?.endsWith('-copy');
  }

  function members(group) {
    return [...(group?.tabs || group?.querySelectorAll?.(':scope > .tab-group-container > tab') || [])]
      .filter(tab => tab?.isConnected && tab.group === group &&
        !tab.hasAttribute('zen-empty-tab') && !tab.hasAttribute('cloned'));
  }

  function groupFromEvent(event) {
    const nodes = event.composedPath?.() || [event.target];
    for (const node of nodes) {
      const label = node?.closest?.('.tab-group-label-container');
      if (label && validGroup(label.parentElement)) return label.parentElement;
    }
    return null;
  }

  function promptConfirm(message) {
    try {
      if (typeof Services.prompt?.confirm === 'function')
        return Services.prompt.confirm(window, 'Zen Site Folders', message);
    } catch (_) {}
    try { return typeof window.confirm === 'function' && window.confirm(message); }
    catch (_) { return false; }
  }

  function promptText(message, oldValue) {
    const value = { value: String(oldValue ?? '') };
    try {
      if (typeof Services.prompt?.prompt === 'function') {
        return Services.prompt.prompt(window, 'Zen Site Folders', message, value, null, {}) ?
          value.value : null;
      }
    } catch (error) { console.warn(TAG, 'Native text prompt unavailable', error); }
    try { return typeof window.prompt === 'function' ? window.prompt(message, value.value) : null; }
    catch (_) { return null; }
  }

  function alertUser(message) {
    try {
      if (typeof Services.prompt?.alert === 'function') {
        Services.prompt.alert(window, 'Zen Site Folders', message);
        return;
      }
    } catch (_) {}
    try { window.alert?.(message); } catch (_) {}
  }

  function archiveSnapshotForMutation(action, keepActiveSnapshot = false) {
    const spaceId = currentSpace();
    const all = read(SNAPSHOT_KEY);
    if (!spaceId || !all) {
      alertUser('無法讀取目前工作區的還原快照。操作已取消。');
      return false;
    }
    const snapshot = all[spaceId];
    if (!snapshot) return true;
    // Caller has already shown the single explicit action confirmation.
    // Archive automatically, verify read-back, and abort on every failure.
    // Do not ask for a second confirmation here.
    const archives = read(ARCHIVE_KEY);
    if (!archives) {
      alertUser('既有封存資料損毀；為保護分頁已取消操作。');
      return false;
    }
    const history = Array.isArray(archives[spaceId]) ? archives[spaceId] : [];
    const item = { archivedAt: Date.now(), reason: 'manual-group-operation',
      action, snapshot: JSON.parse(JSON.stringify(snapshot)) };
    const nextArchive = { ...archives, [spaceId]: [...history, item] };
    if (!write(ARCHIVE_KEY, nextArchive)) {
      alertUser('快照封存失敗，未修改任何分頁。');
      return false;
    }
    // For manual "解散群組", keep the active snapshot and rescue arrow
    // until remaining owned groups can be safely handled. A lost tab ID or
    // partial ungroup must never erase the only visible recovery entry.
    if (keepActiveSnapshot) return true;
    const next = { ...all };
    delete next[spaceId];
    if (!write(SNAPSHOT_KEY, next)) {
      alertUser('已封存快照，但無法解除舊還原鎖定；操作已取消。');
      return false;
    }
    // Core's Undo button is updated after its next workspace event. Refresh
    // without performing any new sorting or restoration.
    try { window.dispatchEvent(new Event('ZenWorkspacesUIUpdate')); } catch (_) {}
    return true;
  }

  function emitUpdate(group) {
    try { group.dispatchEvent(new CustomEvent('TabGroupUpdate', { bubbles: true })); }
    catch (_) {}
  }

  function rename(group) {
    const input = promptText('輸入群組名稱：', group.label || group.getAttribute('label') || '');
    if (input == null) return;
    const name = input.trim();
    if (!name || name.length > 80) { alertUser('群組名稱必須是 1～80 個字元。'); return; }
    group.label = name;
    emitUpdate(group);
  }

  function validIcon(icon) {
    if (typeof icon !== 'string' || icon.length > 32768) return false;
    if (/^(chrome|resource):\/\//.test(icon)) return true;
    if (/^data:image\/svg\+xml[,;]/i.test(icon)) return true;
    // Emoji / short glyphs only, not arbitrary URLs or injected markup.
    return icon.length > 0 && icon.length <= 12 &&
      !/[<>]/.test(icon) && !/^[a-z]+:/i.test(icon);
  }

  function applyIcon(group, icon) {
    if (!validGroup(group)) return;
    const label = group.querySelector('.tab-group-label-container');
    const favicon = label?.querySelector('.zsf-favicon');
    if (!favicon || !label) return;
    const currentEmoji = label.querySelector('.zsf-menu-emoji');
    if (!icon) {
      if (!group.hasAttribute('data-zsf-custom-icon') && !currentEmoji && !favicon.hidden) return;
      currentEmoji?.remove();
      group.removeAttribute('data-zsf-custom-icon');
      favicon.hidden = false;
      window.__zenSiteFoldersV029?.reapplyAppearance?.();
    } else if (validIcon(icon)) {
      if (!group.hasAttribute('data-zsf-custom-icon'))
        group.setAttribute('data-zsf-custom-icon', 'true');
      if (/^(chrome|resource):\/\/|^data:image\/svg\+xml[,;]/i.test(icon)) {
        currentEmoji?.remove();
        favicon.hidden = false;
        if (favicon.getAttribute('src') !== icon) favicon.setAttribute('src', icon);
      } else {
        favicon.hidden = true;
        if (currentEmoji) {
          if (currentEmoji.textContent !== icon) currentEmoji.textContent = icon;
        } else {
          const emoji = document.createXULElement('label');
          emoji.classList.add('zsf-menu-emoji');
          emoji.textContent = icon;
          label.insertBefore(emoji, favicon.nextSibling);
        }
      }
    }
  }

  function persistIcon(group, value) {
    const icons = read(ICONS_KEY);
    if (!icons) { alertUser('無法讀取圖示設定，已取消。'); return; }
    if (!value) delete icons[group.id];
    else icons[group.id] = value;
    if (!write(ICONS_KEY, icons)) {
      alertUser('無法儲存圖示設定，未更改圖示。');
      return;
    }
    applyIcon(group, value || null);
  }

  function chooseIcon(group) {
    const anchor = group.querySelector('.zsf-favicon') ||
      group.querySelector('.tab-group-label-container');
    const picker = window.gZenEmojiPicker;
    if (anchor && typeof picker?.open === 'function') {
      picker.open(anchor, {
        onlySvgIcons: false,
        allowNone: true,
        closeOnSelect: true,
        onSelect: icon => {
          if (icon && !validIcon(icon)) {
            alertUser('目前不支援這個圖示格式。');
            return;
          }
          persistIcon(group, icon);
        },
      });
      return;
    }
    const fallback = promptText('輸入一個圖示表情符號（或內建 chrome:// SVG 圖示網址）：', '');
    if (fallback == null) return;
    if (!validIcon(fallback)) { alertUser('圖示格式無效。'); return; }
    persistIcon(group, fallback);
  }

  function removeIcon(group) { persistIcon(group, null); }

  function restoreDecorations() {
    if (dead) return;
    const icons = read(ICONS_KEY) || {};
    for (const group of document.querySelectorAll(GROUP_SELECTOR)) {
      if (!validGroup(group)) continue;
      if (icons[group.id]) applyIcon(group, icons[group.id]);
      else if (group.hasAttribute('data-zsf-custom-icon')) applyIcon(group, null);
      group.style.removeProperty('--zsf-custom-accent');
    }
  }

  async function ungroup(group) {
    const list = members(group);
    const helper = window.__zenSiteFoldersV037?.ungroupInDisplayOrder;
    if (typeof helper !== 'function') {
      alertUser('保序解散功能尚未載入；為避免分頁倒序，沒有進行解散。');
      return;
    }
    if (!list.length) { alertUser('群組中沒有可解散的一般分頁。'); return; }
    // A normal ungroup never closes tabs or reloads pages. The menu command
    // itself is explicit consent; archive and perform it without a modal.
    // Deleting a group or converting to pinned remains confirmed separately.
    if (!archiveSnapshotForMutation('解散群組', true)) return;
    const result = await helper(group, list);
    if (result.errors || result.moved !== list.length || !result.ordered) {
      alertUser('部分解散或順序驗證失敗：已解散 ' + result.moved +
        ' 個分頁，請核對。快照及還原箭頭仍保留。');
    }
  }

  function deleteGroup(group) {
    const list = members(group);
    if (typeof window.gBrowser?.removeTabGroup !== 'function') {
      alertUser('目前 Zen 不支援刪除群組。'); return;
    }
    if (!promptConfirm('確定刪除「' + group.label + '」？\n' +
      '這會關閉 ' + list.length + ' 個分頁，並可能導致未儲存內容遺失。\n' +
      '如果有整理快照，會自動先封存備份。')) return;
    if (!archiveSnapshotForMutation('刪除群組')) return;
    try {
      if (!group.isConnected) return;
      window.gBrowser.removeTabGroup(group);
    } catch (error) {
      console.error(TAG, 'Delete group failed', error);
      alertUser('刪除群組失敗，請核對分頁。');
    }
  }

  function convert(group) {
    const list = members(group);
    if (!list.length) return;
    const createFolder = window.gZenFolders?.createFolder;
    if (typeof createFolder !== 'function') { alertUser('Zen 分頁夾功能目前不可用。'); return; }
    if (!promptConfirm('確定把「' + group.label + '」轉為 Zen 分頁夾？\n' +
      list.length + ' 個分頁將移往上方釘選區。\n' +
      '如果有整理快照，會自動先封存備份。')) return;
    if (!archiveSnapshotForMutation('轉為 Zen 分頁夾')) return;
    try {
      const folder = createFolder.call(window.gZenFolders, list, {
        label: group.label || '資料夾',
        renameFolder: false,
        workspaceId: currentSpace(),
      });
      if (!folder?.isZenFolder || list.some(tab => !tab.isConnected || tab.group !== folder)) {
        alertUser('Zen 資料夾轉換未完整完成，請核對分頁；沒有執行額外刪除。');
        return;
      }
      // Zen normally automatically removes empty plain groups. Never call
      // removeTabGroup on a group that might still own a live tab.
      if (group.isConnected && !members(group).length) {
        try { window.gBrowser?.removeTabGroup?.(group); } catch (_) {}
      }
    } catch (error) {
      console.error(TAG, 'Convert failed', error);
      alertUser('轉換資料夾失敗，請核對目前分頁。');
    }
  }

  function workspaces() {
    const result = window.gZenWorkspaces?.getWorkspaces?.();
    return Array.isArray(result) ? result :
      Array.isArray(result?.workspaces) ? result.workspaces : [];
  }

  function moveToSpace(group, id) {
    const ws = window.gZenWorkspaces;
    const target = ws?.workspaceElement?.(id);
    const list = members(group);
    if (!target?.tabsContainer || !list.length) return;
    if (id === currentSpace()) return;
    if (!window.gBrowser?.zenHandleTabMove) {
      alertUser('此版本 Zen 不支援安全移動整個群組至其他工作區。');
      return;
    }
    if (!promptConfirm('確定將「' + group.label + '」及 ' +
      list.length + ' 個分頁移到其他工作區？')) return;
    if (!archiveSnapshotForMutation('移動群組至其他工作區')) return;
    try {
      const old = currentSpace();
      const targetContainer = target.tabsContainer;
      const periphery = targetContainer.querySelector('#tabbrowser-arrowscrollbox-periphery');
      window.gBrowser.zenHandleTabMove(group, () => {
        group.setAttribute('zen-workspace-id', id);
        for (const tab of list) tab.setAttribute('zen-workspace-id', id);
        targetContainer.insertBefore(group, periphery || null);
      });
      if (group.parentElement !== targetContainer || list.some(tab => tab.group !== group)) {
        alertUser('移動群組結果未通過驗證，請核對工作區分頁。');
        return;
      }
      if (old && list.includes(ws.lastSelectedWorkspaceTabs?.[old]))
        delete ws.lastSelectedWorkspaceTabs[old];
      emitUpdate(group);
    } catch (error) {
      console.error(TAG, 'Move group failed', error);
      alertUser('移動群組失敗，請核對工作區。');
    }
  }

  function xul(name, label, handler) {
    const element = document.createXULElement(name);
    if (label != null) element.setAttribute('label', label);
    if (handler) bind(element, 'command', async () => {
      // XUL may fire popuphidden before command. Persist the target on the
      // menu itself so the first click does not silently lose its group.
      const group = activeGroup || menu?.zsfTargetGroup;
      if (!validGroup(group)) return;
      try { await handler(group); }
      catch (error) { console.error(TAG, 'Menu action failed', error); alertUser('群組操作失敗，未進行後續動作。'); }
    });
    return element;
  }

  function sub(menuPopup, label) {
    const parent = xul('menu', label);
    const popup = xul('menupopup');
    parent.appendChild(popup);
    menuPopup.appendChild(parent);
    return popup;
  }

  function createMenu() {
    if (menu?.isConnected) return menu;
    menu = xul('menupopup');
    menu.id = 'zsf-site-group-menu';
    menu.appendChild(xul('menuitem', '重新命名', rename));
    menu.appendChild(xul('menuitem', '變更圖示', chooseIcon));
    menu.appendChild(xul('menuitem', '移除圖示', removeIcon));
    menu.appendChild(xul('menuseparator'));
    const spaces = sub(menu, '移到工作區');
    bind(spaces, 'popupshowing', () => {
      while (spaces.firstChild) spaces.firstChild.remove();
      for (const ws of workspaces()) {
        if (!ws?.uuid) continue;
        const item = xul('menuitem', ws.name || '未命名工作區', group => moveToSpace(group, ws.uuid));
        if (ws.uuid === currentSpace()) item.setAttribute('disabled', 'true');
        spaces.appendChild(item);
      }
    });
    menu.appendChild(xul('menuseparator'));
    menu.appendChild(xul('menuitem', '解散群組', ungroup));
    menu.appendChild(xul('menuitem', '轉為 Zen 分頁夾（上方釘選）', convert));
    menu.appendChild(xul('menuseparator'));
    menu.appendChild(xul('menuitem', '刪除群組', deleteGroup));
    bind(menu, 'popuphidden', () => {
      activeGroup = null;
      // Keep menu.zsfTargetGroup until the next opening: a queued native XUL
      // command can run after popuphidden. It is validated before every action.
    });
    (document.getElementById('mainPopupSet') || document.documentElement).appendChild(menu);
    return menu;
  }

  function onContextMenu(event) {
    if (dead) return;
    const group = groupFromEvent(event);
    if (!group) return;
    if (!createMenu()?.openPopupAtScreen) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    activeGroup = group;
    menu.zsfTargetGroup = group;
    // This is a context menu, not a generic popup. Gecko needs its context-menu
    // interaction state for native pointer tracking and menu-item highlighting.
    menu.openPopupAtScreen(event.screenX, event.screenY, true);
  }

  function ordinaryContextTab() {
    const tab = window.TabContextMenu?.contextTab;
    return tab?.isConnected && tab.localName === 'tab' &&
      !tab.hasAttribute('zen-essential') && !tab.hasAttribute('zen-empty-tab') ? tab : null;
  }
  function installTabColorMenu() {
    const popup = document.getElementById('tabContextMenu');
    if (!popup || tabColorItem?.isConnected) return;
    tabColorItem = document.createXULElement('menuitem');
    tabColorItem.id = 'zsf-change-selected-tab-color';
    tabColorItem.setAttribute('label', '變更選取分頁顏色');
    tabColorItem.hidden = true;
    // Keep the native tab context menu and its normal commands intact.
    const anchor = document.getElementById('context_duplicateTab');
    popup.insertBefore(tabColorItem, anchor?.parentElement === popup ? anchor : null);
    bind(popup, 'popupshowing', event => {
      if (event.target === popup) tabColorItem.hidden = !ordinaryContextTab();
    });
    bind(tabColorItem, 'command', () => {
      const tab = ordinaryContextTab();
      if (tab) chooseSelectedColor(tab);
    });
  }
  function init() {
    if (initialized || dead) return;
    if (!window.gBrowser?.tabContainer) return;
    initialized = true;
    applySelectedColor();
    installTabColorMenu();
    Services.obs.addObserver(colorObserver, COLOR_TOPIC);
    bind(window, 'contextmenu', onContextMenu, true);
    restoreDecorations();
    const container = window.gBrowser.tabContainer;
    observer = new MutationObserver(records => {
      const addedGroup = records.some(record => record.type === 'attributes'
        ? record.target.matches?.(GROUP_SELECTOR)
        : [...record.addedNodes].some(node =>
          node.matches?.(GROUP_SELECTOR) || node.querySelector?.(GROUP_SELECTOR)));
      if (!addedGroup) return;
      clearTimeout(init._timer);
      init._timer = setTimeout(restoreDecorations, 120);
    });
    observer.observe(container, { childList: true, subtree: true,
      attributes: true, attributeFilter: ['data-zsf-site'] });
    bind(window, 'ZenWorkspacesUIUpdate', () => setTimeout(restoreDecorations, 100));
    bind(window, 'AfterWorkspacesSessionRestore', () => setTimeout(restoreDecorations, 100));
    bind(container, 'TabGroupCreate', () => setTimeout(restoreDecorations, 150));
  }

  function destroy() {
    dead = true;
    colorDialog?.close();
    tabColorItem?.remove();tabColorItem = null;
    try { Services.obs.removeObserver(colorObserver, COLOR_TOPIC); } catch (_) {}
    clearTimeout(init._timer);
    observer?.disconnect();
    for (const [node, type, callback, capture] of listeners)
      try { node.removeEventListener(type, callback, capture); } catch (_) {}
    if (menu) menu.zsfTargetGroup = null;
    menu?.remove();
  }

  const api = { init, destroy, validGroup, members, restoreDecorations,
    openSelectedColor: chooseSelectedColor, version: '0.4.1' };
  window.__zsfMenuV037 = api;
  if (document.readyState === 'complete') init();
  else bind(window, 'load', init, { once: true });
  bind(window, 'unload', destroy, { once: true });
})();
