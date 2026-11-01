const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'site-folders-drag.uc.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'userChrome.css'), 'utf8');
new vm.Script(src);
assert(!/\.(?:moveTabBefore|moveTabToExistingGroup|zenHandleTabMove|pinTab|unpinTab|removeTab)\s*\(/.test(src),
  'drag feedback must not move/pin/remove tabs');
assert(!/preventDefault\(|stopPropagation\(|setDragImage\(|dropEffect\s*=/.test(src),
  'native Zen/Zia must retain complete control of drag and drop');
assert(css.includes('.zsf-drag-ghost') && css.includes('.zsf-drop-guide'));
assert(css.includes('pointer-events: none !important'), 'overlays must not intercept drops');

const events = new Map();
class Node {
  constructor(type = 'div', classes = '') {
    this.type = type;
    this.localName = type;
    this.className = classes;
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
    this.attrs = new Map();
    this.style = {};
    this.hidden = false;
    this.textContent = '';
    this.box = { left: 20, top: 20, right: 470, bottom: 52, width: 450, height: 32 };
  }
  append(...nodes) { for (const n of nodes) { n.parentElement = this; this.children.push(n); } }
  appendChild(n) { this.append(n); }
  setAttribute(k, v) { this.attrs.set(k, v); }
  getAttribute(k) { return this.attrs.get(k) || null; }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  getBoundingClientRect() { return this.box; }
  get offsetWidth() { return 178; }
  get offsetHeight() { return 42; }
  remove() {
    this.isConnected = false;
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter(x => x !== this);
  }
  querySelector(selector) {
    if (selector === ':scope > .tab-group-label-container')
      return this.children.find(x => x.className === 'tab-group-label-container') || null;
    const className = selector.match(/\.([a-z][\w-]*)$/i)?.[1];
    if (className) {
      const find = node => node.children.find(c => c.className?.split(' ').includes(className)) ||
        node.children.map(find).find(Boolean);
      return find(this) || null;
    }
    return null;
  }
  matches(selector) {
    if (selector === 'tab-group[data-zsf-site]:not([split-view-group])')
      return this.type === 'tab-group' && this.hasAttribute('data-zsf-site');
    if (selector === 'tab-group:not([split-view-group])')
      return this.type === 'tab-group';
    if (selector.startsWith('.tabbrowser-tab:not([pinned])'))
      return this.type === 'tab' && !this.hasAttribute('pinned');
    return false;
  }
  closest(selector) {
    if (selector === '.tab-group-label-container' && this.className === 'tab-group-label-container')
      return this;
    return this.parentElement?.closest(selector) || null;
  }
}
const root = new Node('root');
const tabs = new Node('vbox');
const sidebar = new Node('sidebar');
sidebar.box = {left:0,top:0,right:508,bottom:970,width:508,height:970};
const parent = new Node('workspace');
root.append(sidebar, tabs);
const source = new Node('tab-group');
source.setAttribute('data-zsf-site', 'reddit.com');
const first = new Node('tab-group');
first.setAttribute('data-zsf-site','about');
const second = new Node('tab-group');
second.setAttribute('data-zsf-site','github.com');
const otherSpace = new Node('workspace');
const outsideGroup = new Node('tab-group');
outsideGroup.setAttribute('data-zsf-site','youtube.com');
root.append(parent, otherSpace);
parent.append(first, source, second);
otherSpace.append(outsideGroup);
function labelFor(group, name, top) {
  group.box = {left:10,top,right:480,bottom:top+35,width:470,height:35};
  const label = new Node('hbox', 'tab-group-label-container');
  label.box = {...group.box};
  const title = new Node('label','tab-group-label');
  title.textContent = name;
  label.append(title);
  group.append(label);
  return label;
}
labelFor(first,'About',105);
const sourceLabel=labelFor(source,'Reddit',145);
labelFor(second,'GitHub',185);
labelFor(outsideGroup,'Other',350);
sourceLabel.querySelector = sel => {
  if (sel.includes('zsf-favicon')) return null;
  return Node.prototype.querySelector.call(sourceLabel,sel);
};
function emit(name, event, target = tabs) {
  for (const fn of events.get(target + ':' + name) || []) fn(event);
}
function addListener(name, fn, options) {
  const key=this+':'+name;
  events.set(key, [...(events.get(key) || []), fn]);
}
function removeListener(name, fn) {
  const key=this+':'+name;
  events.set(key, (events.get(key) || []).filter(x => x !== fn));
}
tabs.addEventListener=addListener.bind(tabs);
tabs.removeEventListener=removeListener.bind(tabs);
const window = {
  innerWidth: 1024,innerHeight:800,
  addEventListener:addListener, removeEventListener:removeListener
};
const doc={
  readyState:'complete',documentElement:root,
  getElementById:id=>id==='tabbrowser-tabs'?tabs:id==='navigator-toolbox'?sidebar:null,
  createElementNS:(ns,name)=>new Node(name)
};
vm.runInNewContext(src,{window,document:doc,console});
const api=window.__zsfDragV036;
assert.equal(api.version,'0.3.6');
const gesture={
  button:0,buttons:1,clientX:160,clientY:160,
  target:sourceLabel,composedPath:()=>[sourceLabel,source]
};
emit('mousedown',gesture,tabs);
assert(!root.querySelector('.zsf-drag-ghost'), 'click alone never creates fake drag UI');
emit('mousemove',{...gesture,clientX:161,clientY:161},window);
assert(!root.querySelector('.zsf-drag-ghost'), 'a tiny mouse movement is not dragging');
emit('mousemove',{...gesture,clientX:162,clientY:126},window);
const ghost=root.querySelector('.zsf-drag-ghost');
const guide=root.querySelector('.zsf-drop-guide');
assert(ghost && guide, 'drag feedback should appear after deliberate movement');
assert.equal(ghost.querySelector('.zsf-drag-title').textContent,'Reddit');
assert.equal(ghost.getAttribute('aria-hidden'),'true');
assert.equal(guide.hidden,false,'valid adjacent group offers a visible insertion guide');
assert.equal(guide.getAttribute('data-position'),'after');
assert(ghost.querySelector('.zsf-drag-hint').textContent.includes('About'));
assert(source.hasAttribute('data-zsf-drag-source'));
assert.deepEqual(parent.children,[first,source,second],
  'visual preview must never reorder native browser elements');

// The selected row changes at the midpoint and marker follows without
// touching the actual normal group placement.
emit('dragover',{...gesture,clientX:160,clientY:188},window);
assert.equal(guide.hidden,false);
assert(ghost.querySelector('.zsf-drag-hint').textContent.includes('GitHub'));
emit('dragover',{...gesture,clientX:900,clientY:500},window);
assert.equal(guide.hidden,true,'outside the ordinary sidebar is never shown as a valid drop');
assert(ghost.hasAttribute('data-invalid'));
emit('mouseup',{...gesture},window);
assert(!source.hasAttribute('data-zsf-drag-source'));
assert(!ghost.isConnected && !guide.isConnected);
assert.deepEqual(parent.children,[first,source,second]);

// Native HTML dragstart must also enter the same feedback state.
emit('dragstart',gesture,window);
assert(root.querySelector('.zsf-drag-ghost'));
emit('dragend',gesture,window);
assert(!root.querySelector('.zsf-drag-ghost'));
api.destroy();
assert.equal((events.get(window+':mousemove')||[]).length,0);
console.log('PASS: visual ghost, adjacent before/after markers, invalid region, no data moves, cleanup and native DnD events');
