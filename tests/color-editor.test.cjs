const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class FakeNode {
  constructor(tag) {
    this.localName = tag;
    this.children = [];
    this.events = {};
    this.attrs = {};
    this.className = '';
    this.isConnected = true;
    this.style = { setProperty: (key, value) => { this.style[key] = value; } };
  }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  appendChild(node) { this.append(node); return node; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  emit(name) { for (const callback of this.events[name] || []) callback({ type: name }); }
  click() { this.emit('click'); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  removeAttribute(key) { delete this.attrs[key]; }
  hasAttribute(key) { return Object.hasOwn(this.attrs, key); }
  getBoundingClientRect() {
    return this.localName === 'dialog' ? { width: 310, height: 244 } :
      { left: 0, right: 260, top: 0, width: 260, height: 640 };
  }
  querySelector(selector) {
    const find = node => {
      for (const child of node.children) {
        if ((selector.startsWith('.') && child.className.split(' ').includes(selector.slice(1))) ||
            (selector === 'input[type="color"]' && child.localName === 'input' && child.type === 'color') ||
            (selector === 'input[type="range"]' && child.localName === 'input' && child.type === 'range'))
          return child;
        const inner = find(child);
        if (inner) return inner;
      }
      return null;
    };
    return find(this);
  }
  show() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
  remove() {
    this.isConnected = false;
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter(child => child !== this);
  }
}

const source = fs.readFileSync(path.join(__dirname, '..', 'site-folders-menu.uc.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'userChrome.css'), 'utf8');
assert(css.includes('width: min(330px, calc(100vw - 16px))'), 'preview card must be 330px');
assert(css.includes('flex: 0 0 42px;min-width: 42px'), 'opening age must have 42px column');
assert(css.includes('#navigator-toolbox[data-zsf-color-sidebar-hold]'), 'compact sidebar hold must be styled');
assert(css.includes('width: min(310px, calc(100vw - 16px))'), 'color panel must be compact');
assert(!source.includes('dialog.showModal()'), 'color editor must not dim the original selected tab');

let stored = JSON.stringify({ hex: '#123456', alpha: 60 });
let notifyCount = 0;
const root = new FakeNode('root');
root.clientWidth = 1000;
root.clientHeight = 640;
root.getAttribute = () => null;
const toolbox = new FakeNode('toolbox');
const tab = { label: '預覽分頁', isConnected: true,
  getBoundingClientRect: () => ({top: 144, height: 34, left: 20, right: 220}) };
const document = {
  readyState: 'loading', documentElement: root,
  createElementNS: (_ns, tag) => new FakeNode(tag),
  getElementById: id => id === 'navigator-toolbox' ? toolbox : null,
};
const window = { innerWidth: 1000, innerHeight: 640,
  gBrowser: { selectedTab: tab }, addEventListener() {}, removeEventListener() {} };
const Services = {
  prefs: { getStringPref: () => stored, setStringPref: (_key, value) => { stored = value; } },
  obs: { notifyObservers() { notifyCount++; }, addObserver() {}, removeObserver() {} },
};
const patched = source.replace('  const colorObserver =',
  '  window.__testColorEditor = chooseSelectedColor;\n  const colorObserver =');
assert.notEqual(patched, source, 'test should hook actual editor implementation');
vm.runInNewContext(patched, { window, document, Services, console, setTimeout, clearTimeout });
const dialogs = () => root.children.filter(child => child.localName === 'dialog');
const colorValue = () => root.style['--zsf-selected-tab-fill'];
const open = () => { window.__testColorEditor(tab); return dialogs()[0]; };

let dialog = open();
assert(dialog.open, 'editor opens without modal backdrop');
assert(toolbox.hasAttribute('data-zsf-color-sidebar-hold'), 'sidebar remains held while editing');
assert.equal(dialog.style.left, '268px', 'editor anchors to outside of left sidebar');
assert.equal(dialog.style.top, '144px', 'editor aligns to context tab');
const color = dialog.querySelector('input[type="color"]');
const alpha = dialog.querySelector('input[type="range"]');
assert.equal(color.value, '#123456');
assert.equal(alpha.value, '60');
color.value = '#aabbcc'; alpha.value = '25'; alpha.emit('input');
assert.equal(colorValue(), 'rgba(170, 187, 204, 0.25)', 'real selected-tab CSS variable updates live');
assert.equal(notifyCount, 0, 'preview must not persist');
dialog.querySelector('.zsf-color-cancel').click();
assert(!toolbox.hasAttribute('data-zsf-color-sidebar-hold'), 'cancel releases sidebar hold');
assert.equal(colorValue(), 'rgba(18, 52, 86, 0.6)', 'cancel restores original color');
assert.equal(stored, JSON.stringify({ hex: '#123456', alpha: 60 }));
assert.equal(dialogs().length, 0, 'closing editor cleans up DOM');

dialog = open();
dialog.querySelector('.zsf-color-reset').click();
assert.equal(colorValue(), 'rgba(255, 255, 255, 0.08)', 'reset previews but does not persist');
dialog.querySelector('.zsf-color-cancel').click();
assert.equal(colorValue(), 'rgba(18, 52, 86, 0.6)');
assert.equal(notifyCount, 0);

dialog = open();
dialog.querySelector('input[type="color"]').value = '#abcdef';
dialog.querySelector('input[type="range"]').value = '65';
dialog.querySelector('.zsf-color-save').click();
assert.deepEqual(JSON.parse(stored), { hex: '#abcdef', alpha: 65 }, 'save persists both values');
assert.equal(colorValue(), 'rgba(171, 205, 239, 0.65)');
assert.equal(notifyCount, 1, 'save notifies other windows once');
assert(!toolbox.hasAttribute('data-zsf-color-sidebar-hold'), 'save releases sidebar hold');
console.log('PASS: compact card widths, anchored editor, live color, cancel, reset and save');
