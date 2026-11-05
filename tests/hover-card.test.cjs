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
    this.style = {
      priorities: {},
      setProperty(key, value, priority = '') {
        this[key] = value;
        this.priorities[key] = priority;
      },
      removeProperty(key) {
        delete this[key];
        delete this.priorities[key];
      },
      getPropertyValue(key) { return this[key] || ''; },
      getPropertyPriority(key) { return this.priorities[key] || ''; }
    };
    this.events = {};
    this.isConnected = true;
    this.hidden = false;
    this.offsetTop = 7;
    // offsetHeight is a layout getter below, not a writable property.
    this.textContent = '';
  }
  append(...children) { for (const child of children) { this.children.push(child); child.parentElement = this; } }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this.replaceCount = (this.replaceCount || 0) + 1; this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  removeAttribute(key) { delete this.attrs[key]; }
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
  get offsetWidth() { return this.tag === 'div' && this.id === 'zsf-folder-hover-card' ? 222 : 20; }
  get offsetHeight() { return this.id === 'zsf-folder-hover-card' ? 420 : 32; }
}

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'site-folders-hover.uc.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'userChrome.css'), 'utf8');
  const core = fs.readFileSync(path.join(__dirname, '..', 'site-folders.uc.js'), 'utf8');

  // The hover script must not call destructive browser operations.
  assert(!/\b(removeTab|closeTab|pinTab|unpinTab)\s*\(/.test(source));
  assert(!/SNAPSHOT_KEY|writeSnapshots|captureSnapshot/.test(source));
  const collapsedRules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]*tab-group\[data-zsf-site\]\[collapsed\][^{}]*\{[^{}]*\}/g) || [];
  for (const rule of collapsedRules) {
    const declarations = rule.slice(rule.indexOf('{'));
    assert(!/(?:^|[;{])\s*(?:height|min-height|max-height|display|margin(?:-[\w-]+)?|animation(?:-[\w-]+)?)\s*:/.test(declarations),
      'collapsed compatibility must not add another geometry or animation controller');
  }
  assert(css.includes('#zsf-folder-hover-card'));
  // Zia 2.117.x uses a pseudo-element hairline when zia.glass is off,
  // and disables card blur behind an HDR/SDR video. Mirror exactly those
  // two native guards without changing the custom preview layout.
  assert(css.includes('@media not -moz-pref("zia.glass")'), 'Zia glass-off gate');
  assert(css.includes('#zsf-folder-hover-card::after'), 'native border paint layer');
  assert(css.includes('border: 0.5px solid rgba(255, 255, 255, 0.12)'), 'native dark hairline');
  assert(css.includes(':root[zia-light] #zsf-folder-hover-card::after'), 'native light hairline');
  assert(css.includes(':root:not([zia-video]) #zsf-folder-hover-card'), 'native glass video gate');
  assert(source.includes("'zia-video', 'class', 'style'"), 'native video state must refresh computed glass');
  assert(css.includes('width: min(310px, calc(100vw - 16px))'), 'preview card width 310px');
  assert(css.includes('flex: 0 0 40px;min-width: 40px'), 'age column width 40px');
  assert(css.includes('gap: 6px !important;'), 'compact horizontal row gap');
  assert(css.includes('.zsf-hover-row > :is(.zsf-hover-icon, .zsf-hover-title, .zsf-hover-age)'),
    'title, icon and time inherit clickable cursor');
  assert(source.includes('const GAP = 8;'), 'fixed sidebar gap preserved');
  assert(source.includes('popup.offsetWidth || 310'), 'card anchored using measured width');

  assert(css.includes('@media -moz-pref("zia.cards.blur")'), 'Zia glass preference is honored');
  assert(css.includes('blur(24px) saturate(1.6)'), 'Zia glass blur matches');

  assert(css.includes('browser[zia-video]'), 'video guard must prevent ZSF preview from forcing colour-washing composition');
  assert(css.includes(':root:has(> #zsf-folder-hover-card:not([hidden])):not('),
    'composition must only be applied for a visible ZSF card without selected video');
  assert(source.includes('getComputedStyle(source)'), 'read actual native Zia paint instead of freezing CSS values');
  assert(source.includes("document.getElementById('zia-folder-card')"), 'native folder style source');
  assert(source.includes("document.getElementById('zia-tab-card')"), 'native tab style fallback');
  assert(source.includes("Services.prefs.addObserver('zia.'"), 'Zia settings should be observed');
  assert(source.includes('MutationObserver'), 'new Zia cards and theme state should trigger re-sync');
  assert(source.includes('stopPaintWatch();'), 'native paint watcher should be released on unload');
  assert(!css.includes('Independent preview-card hairline:'), 'no extra custom border over native Zia edge');
  assert(css.includes('max-height: calc(100vh - 16px)'), 'viewport clamp required');
  assert(css.includes('[data-closing]'), 'Zia-style exit animation required');
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
  const originalZiaWave = 'url("data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2016%2016%22%3E%3C%2Fsvg%3E#3")';
  first.style = { getPropertyValue: name =>
    name === '--zia-sound-wave' ? originalZiaWave : '' };
  first.hasAttribute = name => name === 'soundplaying';
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
    removeTab(tab, options) {
      assert.equal(options.animate, true);
      if (tabContainer.events.TabClose)
        tabContainer.events.TabClose({ target: tab });
      tab.closing = true;
      group.tabs.splice(group.tabs.indexOf(tab), 1);
      tab.isConnected = false;
    },
  };
  const window = {
    gBrowser: browser, innerWidth: 1440, innerHeight: 900, events: {},
    addEventListener(type, fn) { this.events[type] = fn; },
    removeEventListener(type) { delete this.events[type]; },
  };
  // Simulate a real, lazy-created native Zia folder card. The Site Folders
  // preview must copy Zia's *computed* paint and resync after a pref change.
  const ziaCard = new FakeNode('div');
  ziaCard.id = 'zia-folder-card';
  const nativePaint = {
    'background-color': 'rgba(38, 38, 38, 0.76)',
    'backdrop-filter': 'blur(24px) saturate(1.6)',
    'box-shadow': 'rgb(10, 10, 10) 0px 1px 4px',
    'border': '0px none rgb(255, 255, 255)',
    'border-radius': '19.5px',
    'corner-shape': 'superellipse(1.93)',
    'color': 'rgb(255, 255, 255)'
  };
  let ziaPrefObserver = null;
  let prefObserverRemoved = false;
  const Services = { prefs: {
    addObserver(prefix, obs) {
      assert.equal(prefix, 'zia.');
      ziaPrefObserver = obs;
    },
    removeObserver(prefix, obs) {
      assert.equal(prefix, 'zia.');
      assert.equal(obs, ziaPrefObserver);
      prefObserverRemoved = true;
    }
  } };
  const document = {
    readyState: 'complete', documentElement: root,
    getElementById: id =>
      id === 'navigator-toolbox' ? host :
      id === 'zia-folder-card' ? ziaCard : null,
    createElementNS: (_ns, type) => new FakeNode(type),
  };
  vm.runInNewContext(source, {
    window, document, console, Services, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval: () => {},
    getComputedStyle: node => {
      assert.equal(node, ziaCard, 'read Zia native card rather than our popup');
      return { getPropertyValue: key => nativePaint[key] || '' };
    }
  });
  const api = window.__zsfGroupHoverV037;
  assert.equal(api.version, '0.5.6');

  host.events.mouseover({ target });
  await new Promise(resolve => setTimeout(resolve, 260));
  const popup = root.children.find(node => node.id === 'zsf-folder-hover-card');
  assert(popup && !popup.hidden, 'hover must show popup');
  assert.equal(popup.style.getPropertyValue('background-color'), nativePaint['background-color'],
    'native Zia computed opacity must be mirrored into the preview');
  assert.equal(popup.style.getPropertyValue('backdrop-filter'), nativePaint['backdrop-filter'],
    'native Zia backdrop blur must be mirrored');
  assert.equal(popup.style.getPropertyValue('box-shadow'), nativePaint['box-shadow'],
    'native Zia glass edge must be mirrored');
  assert.equal(popup.style.getPropertyPriority('background-color'), 'important',
    'native computed styles must override the fallback Site Folders CSS');
  nativePaint['background-color'] = 'rgba(20, 20, 24, 0.89)';
  nativePaint['backdrop-filter'] = 'blur(30px) saturate(1.3)';
  assert(ziaPrefObserver, 'should listen for live Zia preference changes');
  ziaPrefObserver.observe(null, 'nsPref:changed', 'zia.cards.blur');
  assert.equal(popup.style.getPropertyValue('background-color'), nativePaint['background-color'],
    'a Zia opacity change must update our visible card without a Site Folders release');
  assert.equal(popup.style.getPropertyValue('backdrop-filter'), nativePaint['backdrop-filter'],
    'a Zia blur change must update our visible card');

  assert(host.hasAttribute('data-zsf-preview-sidebar-hold'),
    'opening external card must keep compact sidebar expanded');
  assert(css.includes('#navigator-toolbox[data-zsf-preview-sidebar-hold]') &&
    css.includes('translate: none !important'),
    'compact-mode sidebar must remain visually open during card hover');
  const manifest = require('../theme.json');
  assert.equal(manifest.version, '0.7.4');
  assert(Date.parse(manifest.updatedAt) > Date.parse('2026-11-01T17:25:00.000Z'),
    'Sine update timestamp must increase beyond prior release');
  const rows = popup.querySelector('.zsf-hover-list').children;
  assert.equal(rows.length, 3, 'all tabs and New Tab row are visible');
  assert.equal(rows[0].zsfTab, first);
  assert.equal(rows[1].zsfTab, second);
  assert.equal(rows[2].dataset.action, 'new');
  assert.equal(rows[0].getAttribute('zia-selected'), 'true', 'selected row uses Zia highlight');
  assert(rows[0].className.includes('zia-folder-card-row'), 'Zia list styling is inherited');
  assert.equal(rows[0].children.length, 5, 'row has favicon, animated sound bars, title, opening age, close');
  assert.equal(rows[0].children[3].className, 'zsf-hover-age', 'age uses its own bounded column');
  const audio = rows[0].children[1];
  assert.equal(audio.tag, 'span', 'native four-bar sound indicator, not static speaker image');
  assert(audio.className.includes('zsf-hover-sound'));
  assert.equal(audio.style['--zsf-audio-image'], originalZiaWave,
    'animated SVG must come unchanged from the Zia variable on the original tab');
  assert.equal(audio.getAttribute('zia-act'), 'mute', 'sound bar retains the mute action');
  assert(css.includes('margin-inline: -3px -3px !important'),
    'sound bars should not add speaker margins to the row gap');
  assert(!audio.src, 'static volume.svg must not be used');
  assert(popup.hasAttribute('data-open'), 'first show plays Zia-style entry animation');
  assert.equal(popup.style.maxHeight, '884px', 'card height limited by window geometry');
  window.innerHeight = 330;
  label.getBoundingClientRect = () => ({ left: 40, right: 225, top: 302, bottom: 328, width: 185, height: 26 });
  api.position(label);
  const computedTop = Number.parseInt(popup.style.top, 10);
  assert(computedTop >= 8 && computedTop + Math.min(popup.offsetHeight, 314) <= 322,
    'bottom anchored card must stay inside a small viewport');
  assert.equal(popup.querySelector('.zsf-hover-list').style.maxHeight, '314px',
    'last New Tab row remains reachable in a scrollable list');
  window.innerHeight = 900;
  label.getBoundingClientRect = () => ({ left: 40, right: 225, top: 158, bottom: 188, width: 185, height: 30 });
  api.position(label);
  assert.equal(first.group, group, 'hover may not move or pin a tab');
  assert.equal(created, 0, 'hover may not create a tab');

  popup.events.click({ target: rows[1], stopPropagation() {} });
  assert.equal(browser.selectedTab, second, 'click must select correct tab');
  assert(popup.hidden, 'popup should hide after selection');
  assert(!host.hasAttribute('data-zsf-preview-sidebar-hold'),
    'choosing a preview tab must release compact sidebar');
  assert(!popup.hasAttribute('data-open'), 'close clears animation flag so it restarts next time');
  // Updating the selection should not reset a long card to its first row.
  host.events.mouseover({ target });
  await new Promise(resolve => setTimeout(resolve, 260));
  const scroller = popup.querySelector('.zsf-hover-list');
  scroller.scrollTop = 97;
  const tabSelectHandler = window.events.TabSelect;
  assert(tabSelectHandler, 'TabSelect refresh listener registered');
  tabSelectHandler();
  assert.equal(popup.querySelector('.zsf-hover-list').scrollTop, 97, 'scroll preserved across selected-tab refresh');
  assert.equal(audio.getAttribute('zia-act'), 'mute', 'audio control remains explicitly clickable');
  // User closes the second member inside the popup. Native TabClose is fired
  // before tab removal, so the preview must not render/reposition twice.
  const stableX = popup.style.left;
  const stableY = popup.style.top;
  const stableOrigin = popup.style.transformOrigin;
  const beforeCount = scroller.replaceCount;
  const closeRow = popup.querySelector('.zsf-hover-list').children[1];
  const closeControl = {
    closest(selector) {
      if (selector === '.zsf-hover-row') return closeRow;
      if (selector === '.zsf-hover-action') return {getAttribute:()=>'close'};
      return null;
    }
  };
  popup.events.click({target: closeControl, stopPropagation() {}});
  assert(popup.hasAttribute('data-acting'), 'close must freeze the card geometry');
  await new Promise(resolve => setTimeout(resolve, 170));
  assert.equal(popup.style.left, stableX, 'closing a preview tab must never shift popup left');
  assert.equal(popup.style.top, stableY, 'closing a preview tab must never jump vertically');
  assert.equal(popup.style.transformOrigin, stableOrigin, 'animation origin must stay fixed');
  assert.equal(scroller.replaceCount - beforeCount, 1,
    'native TabClose plus explicit close must produce one debounced render');
  assert.equal(scroller.children.length, 2, 'remaining member and New Tab are visible');
  assert(!popup.hidden, 'card stays open after one member closes');
  assert(host.hasAttribute('data-zsf-preview-sidebar-hold'),
    'closing one member must not prematurely collapse preview sidebar');
  assert(css.includes('#zsf-folder-hover-card[data-acting]'), 'close freeze CSS is active');
  api.closeNow();
  assert(!host.hasAttribute('data-zsf-preview-sidebar-hold'),
    'closing preview must always release sidebar hold');

  // Only our own groups trigger a preview, never Zia native folders.
  const other = { ...group, matches: () => false };
  const otherTarget = { closest: () => ({ ...label, parentElement: other }) };
  host.events.mouseover({ target: otherTarget });
  await new Promise(resolve => setTimeout(resolve, 250));
  assert(popup.hidden, 'non-ZSF group must not open a hover card');

  host.events.mouseover({ target });
  await new Promise(resolve => setTimeout(resolve, 260));
  const fresh = popup.querySelector('.zsf-hover-list').children;
  const newRow = fresh.find(row => row.dataset?.action === 'new');
  assert(newRow, 'New Tab row must remain available after closing a member');
  popup.events.click({ target: newRow, stopPropagation() {} });
  assert.equal(created, 1, 'new tab only after an explicit click');
  assert.equal(browser.selectedTab.group, group);
  assert.equal(browser.selectedTab.pinned, false);
  assert.equal(group.tabs[0], browser.selectedTab, 'new tab must be inserted at top');

  api.destroy();
  assert(!host.hasAttribute('data-zsf-preview-sidebar-hold'),
    'unload must not leave compact sidebar locked');
  assert.equal(popup.isConnected, false, 'unload must remove the popup');
  assert(prefObserverRemoved, 'unload must remove the Zia preference watcher');
  assert.equal(Object.keys(host.events).length, 0, 'unload must remove host listeners');
  console.log('PASS: hover preview, click selection, native-folder exclusion, explicit new tab, cleanup, safety guards');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
