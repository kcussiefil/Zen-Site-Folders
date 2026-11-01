const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'site-folders-menu.uc.js'), 'utf8');
const core = fs.readFileSync(path.join(__dirname, '..', 'site-folders.uc.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'userChrome.css'), 'utf8');
new vm.Script(script);
new vm.Script(core);
assert(css.includes('translate: 0 2px !important'), 'text alignment correction present');
assert(!/window\.gBrowser\.(?:pinTab|unpinTab)\(/.test(script), 'menu must not silently pin tabs');

class XulNode {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.events = {};
    this.style = { values: {}, setProperty: (k, v) => { this.style.values[k] = v; },
      removeProperty: k => { delete this.style.values[k]; } };
    this.classList = { values: new Set(), add: v => this.classList.values.add(v) };
    this.isConnected = true;
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  insertBefore(child) { return this.appendChild(child); }
  remove() {
    this.isConnected = false;
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this);
  }
  get firstChild() { return this.children[0] || null; }
  setAttribute(key, val) { this.attrs[key] = String(val); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  hasAttribute(key) { return Object.hasOwn(this.attrs, key); }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.events[type] = (this.events[type] || []).filter(f => f !== fn); }
  openPopupAtScreen(x, y) { this.opened = [x, y]; }
  matches() { return false; }
  closest() { return null; }
  querySelector(selector) {
    if (selector === '.zsf-favicon') return this.children.find(n => n.isFavicon) || null;
    if (selector === '.zsf-menu-emoji') return this.children.find(n => n.classList?.values.has('zsf-menu-emoji')) || null;
    if (selector === '.tab-group-label-container') return this.children.find(n => n.isLabel) || null;
    return null;
  }
}

function makeHarness({ archiveCorrupt = false, prompts = [], savedSnapshot = true } = {}) {
  const listeners = {};
  const alerts = [];
  let removeCount = 0, ungroupCount = 0, convertCount = 0;
  let confirmCount = 0;
  const saved = {};
  if (savedSnapshot) saved['zsf-before-sort-v1'] = JSON.stringify({
    space1: { version: 4, capturedAt: 1234, createdFolders: ['zsf-owned'],
      tabs: [{ id: 'first', group: null, pinned: false }], elements: [] }
  });
  if (archiveCorrupt) saved['zsf-archived-snapshots-v1'] = '{corrupt';
  const SessionStore = {
    getCustomWindowValue: (_, key) => saved[key] || '',
    setCustomWindowValue: (_, key, value) => { saved[key] = value; },
  };
  const label = new XulNode('hbox');
  label.isLabel = true;
  label.closest = query => query === '.tab-group-label-container' ? label : null;
  const favicon = new XulNode('image');
  favicon.isFavicon = true;
  label.appendChild(favicon);
  const group = new XulNode('tab-group');
  group.id = 'zsf-owned';
  group.label = 'YouTube';
  group.color = 'grey';
  group.tabs = [];
  group.appendChild(label);
  group.setAttribute('data-zsf-site', 'youtube.com');
  group.matches = sel => sel === 'tab-group[data-zsf-site]:not([split-view-group])';
  const tabs = ['old', 'new'].map(name => ({
    label: name, isConnected: true, pinned: false, group,
    hasAttribute: () => false, getAttribute: () => 'space1'
  }));
  group.tabs = tabs;
  const window = {
    SessionStore,
    gZenWorkspaces: { activeWorkspace: 'space1', getWorkspaces: () => [{
      uuid: 'space1', name: '目前工作區'
    }, { uuid: 'space2', name: '工作區二' }] },
    gBrowser: {
      tabContainer: new XulNode('tabs'),
      ungroupTab(tab) { ungroupCount++; tab.group = null; },
      removeTabGroup() { removeCount++; },
    },
    gZenEmojiPicker: { open(anchor, options) { window.iconPicker = options; } },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(f => f !== fn); },
    dispatchEvent() {},
  };
  const popupSet = new XulNode('popupset');
  const doc = {
    readyState: 'complete', documentElement: new XulNode('root'),
    createXULElement: tag => new XulNode(tag),
    getElementById: id => id === 'mainPopupSet' ? popupSet : null,
    querySelectorAll: selector => selector === 'tab-group[data-zsf-site]:not([split-view-group])' ? [group] : [],
  };
  const prompt = {
    confirm() { confirmCount++; return prompts.length ? prompts.shift() : true; },
    prompt(_win, _title, _label, answer) { answer.value = '新的名稱'; return true; },
    alert(_win, _title, msg) { alerts.push(msg); }
  };
  class FakeMutationObserver { observe() {} disconnect() {} }
  vm.runInNewContext(script, { window, document: doc, Services: { prompt }, ChromeUtils: {},
    MutationObserver: FakeMutationObserver, console, setTimeout, clearTimeout, Event: class Event {} });
  const api = window.__zsfMenuV031;
  assert.equal(api.version, '0.3.1');
  const event = { target: label, screenX: 30, screenY: 40, prevented: false,
    composedPath: () => [label, group],
    preventDefault() { this.prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {} };
  const context = () => {
    for (const fn of listeners.contextmenu || []) fn(event);
    assert.equal(event.prevented, true);
    const menu = popupSet.children.find(node => node.id === 'zsf-site-group-menu');
    assert(menu && menu.opened, 'native menu must open');
    return menu;
  };
  function find(item, label) {
    if (item.getAttribute?.('label') === label) return item;
    for (const child of item.children || []) {
      const hit = find(child, label);
      if (hit) return hit;
    }
    return null;
  }
  const command = (menu, label) => {
    const item = find(menu, label);
    assert(item, 'missing menu option: ' + label);
    for (const fn of item.events.command || []) fn({});
  };
  return { api, window, group, label, favicon, tabs, saved, context, command, alerts,
    stats: () => ({ ungroupCount, removeCount, convertCount, confirmCount }), find };
}

async function testMenu() {
  const a = makeHarness();
  const menu = a.context();
  for (const label of ['變更顏色', '重新命名', '變更圖示', '移除圖示',
    '移到工作區', '解散群組', '轉為 Zen 分頁夾（上方釘選）', '刪除群組']) {
    assert(a.find(menu, label), 'missing translated item ' + label);
  }
  a.command(menu, '重新命名');
  assert.equal(a.group.label, '新的名稱');
  a.command(menu, '藍色');
  assert.equal(a.group.color, 'blue');
  assert.equal(a.group.style.values['--zsf-custom-accent'], '#4d91df');
  a.command(menu, '變更圖示');
  assert(a.window.iconPicker, 'Zen native picker should be reused');
  a.window.iconPicker.onSelect('chrome://global/skin/icons/settings.svg');
  assert.equal(a.favicon.getAttribute('src'), 'chrome://global/skin/icons/settings.svg');
  assert.equal(JSON.parse(a.saved['zsf-custom-icons-v1'])['zsf-owned'],
    'chrome://global/skin/icons/settings.svg');
  a.command(menu, '移除圖示');
  assert(!a.group.hasAttribute('data-zsf-custom-icon'), 'icon override cleared');
  const unrelated = new XulNode('tab-group');
  unrelated.isConnected = true;
  unrelated.matches = () => false;
  assert.equal(a.api.validGroup(unrelated), false, 'non-ZSF group excluded');
  a.api.destroy();

  const cancel = makeHarness({ prompts: [false] });
  cancel.command(cancel.context(), '解散群組');
  assert.equal(cancel.stats().ungroupCount, 0);
  assert(JSON.parse(cancel.saved['zsf-before-sort-v1']).space1);

  const corrupt = makeHarness({ archiveCorrupt: true, prompts: [true] });
  corrupt.command(corrupt.context(), '解散群組');
  assert.equal(corrupt.stats().ungroupCount, 0);
  assert(JSON.parse(corrupt.saved['zsf-before-sort-v1']).space1);

  const yes = makeHarness({ prompts: [true] });
  yes.command(yes.context(), '解散群組');
  assert.equal(yes.stats().ungroupCount, 2);
  assert.equal(yes.stats().confirmCount, 1, 'one confirmation must cover both action and automatic snapshot archive');
  assert(yes.tabs.every(t => t.isConnected && !t.pinned && t.group === null));
  assert(!JSON.parse(yes.saved['zsf-before-sort-v1']).space1);
  const archived = JSON.parse(yes.saved['zsf-archived-snapshots-v1']).space1;
  assert.equal(archived.length, 1);
  assert.equal(archived[0].snapshot.tabs.length, 1);

  const deleteCancelled = makeHarness({ prompts: [false] });
  deleteCancelled.command(deleteCancelled.context(), '刪除群組');
  assert.equal(deleteCancelled.stats().removeCount, 0);

  const convertCancelled = makeHarness({ prompts: [false] });
  convertCancelled.command(convertCancelled.context(), '轉為 Zen 分頁夾（上方釘選）');
  assert(convertCancelled.tabs.every(t => !t.pinned));
  console.log('PASS: Traditional Chinese menu, localized commands, picker, color, archival guards, ungroup, cancel, isolation');
}

function testNewestFirst() {
  const code = core.replace("  if (document.readyState === 'complete') initialize();",
    "  window.__testSort={sortOwnedGroupNewestFirst};\n  if (document.readyState === 'complete') initialize();");
  const order = [];
  const tabs = [10, 30, 20].map((stamp, i) => ({
    stamp, isConnected: true, pinned: false, hasAttribute: () => false,
    closest: () => null, getAttribute: () => 'space1'
  }));
  const group = {
    id: 'zsf-test', isConnected: true, pinned: false, isZenFolder: false,
    tabs, hasAttribute: () => false,
    getAttribute: key => key === 'data-zsf-site' ? 'youtube.com' : null,
    setAttribute() {},
  };
  tabs.forEach(t => t.group = group);
  const store = {
    getCustomTabValue: tab => String(tab.stamp),
    setCustomTabValue() {},
    getCustomWindowValue: () => '',
    setCustomWindowValue() {},
  };
  const browser = {
    moveTabBefore(left, right) {
      assert.equal(left.group, group);
      assert.equal(right.group, group);
      assert.equal(left.pinned, false);
      const i = tabs.indexOf(left);
      if (i >= 0) tabs.splice(i, 1);
      tabs.splice(tabs.indexOf(right), 0, left);
      order.push([...tabs].map(t => t.stamp));
    }
  };
  const window = { SessionStore: store, gBrowser: browser, addEventListener() {} };
  const document = { readyState: 'loading' };
  vm.runInNewContext(code, { window, document, ChromeUtils: { importESModule: () => ({ SessionStore: store }) },
    Services: {}, console, setTimeout, clearTimeout });
  window.__testSort.sortOwnedGroupNewestFirst(group);
  assert.deepEqual([...tabs].map(t => t.stamp), [30, 20, 10]);
  assert(order.length > 0);
  assert(tabs.every(t => t.group === group && !t.pinned));
  console.log('PASS: newest opened tab first, oldest last, no pinning, no group movement');
}

testMenu().then(testNewestFirst).catch(error => { console.error(error); process.exitCode = 1; });
