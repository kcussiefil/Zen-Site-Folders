/* Regression tests for the UI-only hover layer. Node.js 22, no packages. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class FakeNode {
  constructor(tag = 'div') {
    this.tag = tag;
    this.className = '';
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.style = {};
    this.events = {};
    this.isConnected = true;
    this.hidden = false;
    this.offsetTop = 7;
    this.offsetHeight = 32;
    this.textContent = '';
  }
  append(...children) { for (const child of children) { this.children.push(child); child.parentElement = this; } }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  hasAttribute(key) { return Object.hasOwn(this.attrs, key); }
  addEventListener(type, handler) { this.events[type] = handler; }
  removeEventListener(type) { delete this.events[type]; }
  remove() { this.isConnected = false; }
  matches(selector) { return selector === ':hover'; }
  closest(selector) {
    if (selector === '.zsf-hover-row' && this.className.includes('zsf-hover-row')) return this;
    return null;
  }
  querySelector(selector) {
    if (selector === '.zsf-hover-list') return this.children.find(node => node.className.includes('zsf-hover-list')) || null;
    if (selector === '.zsf-hover-row') return this.querySelector('.zsf-hover-list')?.children[0] || null;
    return null;
  }
  getBoundingClientRect() { return { top: 120, left: 100, width: 222, height: 128, right: 322, bottom: 248 }; }
}

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'site-folders-hover.uc.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'userChrome.css'), 'utf8');
  const core = fs.readFileSync(path.join(__dirname, '..', 'site-folders.uc.js'), 'utf8');

  // The hover script must not call destructive browser operations.
  assert(!/\b(removeTab|closeTab|pinTab|unpinTab)\s*\(/.test(source));
  assert(!/SNAPSHOT_KEY|writeSnapshots|captureSnapshot/.test(source));
  assert(css.includes('tab-group[data-zsf-site][collapsed]'));
  assert(css.includes('#zsf-folder-hover-card'));
  assert(css.includes('@media -moz-pref("zia.cards.blur")'), 'Zia glass preference is honored');
  assert(css.includes('blur(24px) saturate(1.6)'), 'Zia glass blur matches');
  assert(!css.includes('display: none !important;\n  max-height: 0 !important;\n  margin: 0 !important;\n  padding: 0 !important;'), 'no hard collapsed display:none that cancels Zia spring');
  assert(!css.includes('zsf-rescue-button'));
  new vm.Script(source);
  new vm.Script(core);

  const root = new FakeNode('window');
  root.clientWidth = 1440;
  root.clientHeight = 900;
  root.getAttribute = key => key === 'zen-right-side' ? 'false' : null;
  const host = new FakeNode('navigator-toolbox');
  host.getBoundingClientRect = () => ({ top: 0, right: 260, left: 0, width: 260, height: 900 });
  const group = {
    collapsed: true, isConnected: true, tabs: [],
    getAttribute: key => key === 'collapsed' ? 'true' : null,
    hasAttribute: key => key === 'collapsed',
    matches: selector => selector === 'tab-group[data-zsf-site]:not([split-view-group])',
    closest: selector => selector === 'zen-workspace' ? { id: 'space' } : null,
  };
  const label = {
    parentElement: group, isConnected: true,
    matches: selector => selector === ':hover',
    getBoundingClientRect: () => ({ left: 40, right: 225, top: 158, bottom: 188, width: 185, height: 30 }),
    contains: () => false,
  };
  const target = { closest: selector => selector === '.tab-group-label-container' ? label : null };
  const makeTab = (label, selected = false) => ({
    label, selected, group, isConnected: true, hidden: false, closing: false, pinned: false,
    hasAttribute: () => false, querySelector: () => null,
  });
  const first = makeTab('YouTube video 1', true);
  const second = makeTab('YouTube video 2');
  group.tabs = [first, second];
  const tabContainer = new FakeNode('tab-container');
  let created = 0;
  const browser = {
    tabContainer, selectedTab: null,
    getIcon: () => 'chrome://test/icon.svg',
    addTrustedTab: () => {
      created++;
      return makeTab('New tab');
    },
    moveTabToExistingGroup: (tab, group) => { tab.group = group; group.tabs.push(tab); },
    moveTabBefore: (tab, before) => {
      const i = group.tabs.indexOf(tab);
      if (i >= 0) group.tabs.splice(i, 1);
      group.tabs.splice(group.tabs.indexOf(before), 0, tab);
    },
  };
  const window = {
    gBrowser: browser, innerWidth: 1440, innerHeight: 900, events: {},
    addEventListener(type, fn) { this.events[type] = fn; },
    removeEventListener(type) { delete this.events[type]; },
  };
  const document = {
    readyState: 'complete', documentElement: root,
    getElementById: id => id === 'navigator-toolbox' ? host : null,
    createElementNS: (_ns, type) => new FakeNode(type),
  };
  vm.runInNewContext(source, { window, document, console, setTimeout, clearTimeout });
  const api = window.__zsfGroupHoverV030;
  assert.equal(api.version, '0.3.0');

  host.events.mouseover({ target });
  await new Promise(resolve => setTimeout(resolve, 260));
  const popup = root.children.find(node => node.id === 'zsf-folder-hover-card');
  assert(popup && !popup.hidden, 'hover must show popup');
  const rows = popup.querySelector('.zsf-hover-list').children;
  assert.equal(rows.length, 3, 'all tabs and New Tab row are visible');
  assert.equal(rows[0].zsfTab, first);
  assert.equal(rows[1].zsfTab, second);
  assert.equal(rows[2].dataset.action, 'new');
  assert.equal(rows[0].getAttribute('zia-selected'), 'true', 'selected row uses Zia highlight');
  assert(rows[0].className.includes('zia-folder-card-row'), 'Zia list styling is inherited');
  assert.equal(first.group, group, 'hover may not move or pin a tab');
  assert.equal(created, 0, 'hover may not create a tab');

  popup.events.click({ target: rows[1], stopPropagation() {} });
  assert.equal(browser.selectedTab, second, 'click must select correct tab');
  assert(popup.hidden, 'popup should hide after selection');
  // Updating the selection should not reset a long card to its first row.
  host.events.mouseover({ target });
  await new Promise(resolve => setTimeout(resolve, 260));
  const scroller = popup.querySelector('.zsf-hover-list');
  scroller.scrollTop = 97;
  const tabSelectHandler = window.events.TabSelect;
  assert(tabSelectHandler, 'TabSelect refresh listener registered');
  tabSelectHandler();
  assert.equal(popup.querySelector('.zsf-hover-list').scrollTop, 97, 'scroll preserved across selected-tab refresh');
  api.closeNow();

  // Only our own groups trigger a preview, never Zia native folders.
  const other = { ...group, matches: () => false };
  const otherTarget = { closest: () => ({ ...label, parentElement: other }) };
  host.events.mouseover({ target: otherTarget });
  await new Promise(resolve => setTimeout(resolve, 250));
  assert(popup.hidden, 'non-ZSF group must not open a hover card');

  host.events.mouseover({ target });
  await new Promise(resolve => setTimeout(resolve, 260));
  const fresh = popup.querySelector('.zsf-hover-list').children;
  popup.events.click({ target: fresh[2], stopPropagation() {} });
  assert.equal(created, 1, 'new tab only after an explicit click');
  assert.equal(browser.selectedTab.group, group);
  assert.equal(browser.selectedTab.pinned, false);
  assert.equal(group.tabs[0], browser.selectedTab, 'new tab must be inserted at top');

  api.destroy();
  assert.equal(popup.isConnected, false, 'unload must remove the popup');
  assert.equal(Object.keys(host.events).length, 0, 'unload must remove host listeners');
  console.log('PASS: hover preview, click selection, native-folder exclusion, explicit new tab, cleanup, safety guards');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
