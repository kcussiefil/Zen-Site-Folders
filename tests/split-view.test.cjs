// Preserve split-view geometry by keeping Zen's native animations in charge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'site-folders-collapse.uc.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'userChrome.css'), 'utf8');
new vm.Script(source);
const calls = [];
const attrs = new Set();
const sty = () => {const m=new Map();return {
 setProperty(k,v){m.set(k,String(v));},removeProperty(k){m.delete(k);},getPropertyValue(k){return m.get(k)||'';}};};
const tab = (label, selected, owner) => ({
 localName:'tab',isConnected:true,label,selected,multiselected:false,group:owner,
 hasAttribute:()=>false,style:sty(),getAnimations:()=>[]
});
const split={hasAttribute:k=>k==='split-view-group'};
const nested=tab('Split pane name',true,split);
const sibling=tab('Other group tab',false,null);
const descendants=[sibling,nested];
let hasSplit=true;
const group={
 isConnected:true,isZenFolder:false,pinned:false,collapsed:true,
 tabs:[sibling],groupContainer:{hidden:true,style:sty()},
 groupStartElement:{style:sty()},matches:()=>true,
 querySelectorAll:s=>s==='tab-group[split-view-group]'?(hasSplit?[split]:[])
   :s==='tab.tabbrowser-tab'?descendants:[],
 removeAttribute:k=>attrs.delete(k),hasAttribute:k=>attrs.has(k),
 dispatchEvent:()=>{}
};
sibling.group=group;
const proto={get activeGroups(){return [];},get childActiveGroups(){return [];},
 get activeTabs(){return this._activeTabs;},set activeTabs(v){this._activeTabs=v;}};
const win={customElements:{get:()=>({prototype:proto})},gBrowser:{selectedTab:nested,
 tabContainer:{_invalidateCachedVisibleTabs(){calls.push('invalidate');}}},
 gZenFolders:{
 animateExpand(g){calls.push('expand');g.groupContainer.hidden=false;
  g.groupStartElement.style.setProperty('margin-top','0px');
  for(const t of [nested,sibling])for(const k of ['height','min-height','opacity'])t.style.removeProperty(k);
  return Promise.resolve();},
 animateCollapse(g){calls.push('collapse');g.groupContainer.hidden=true;
  g.groupStartElement.style.setProperty('margin-top','-420px');
  return Promise.resolve();},
 styleCleanup(){throw Error('split rows must not be individually restyled');}
 },addEventListener(){}};
vm.runInNewContext(source,{window:win,document:{readyState:'loading'},console,queueMicrotask});
const api=win.__zsfCollapseV037;
(async()=>{
  group.groupStartElement.style.setProperty('margin-top','-420px');
  sibling.style.setProperty('height','0px');sibling.style.setProperty('opacity','0');
  api.sync(group);
  await api.whenIdle(group);
  assert.deepEqual(calls,['collapse'],'collapsed split host uses native collapse');
  group.collapsed=false;api.sync(group);await api.whenIdle(group);
  assert.deepEqual(calls,['collapse','expand'],'expanded split host uses native expand');
  assert.equal(group.groupStartElement.style.getPropertyValue('margin-top'),'0px',
    'native expand must restore groupStart geometry, preventing overlapping rows');
  assert.equal(sibling.style.getPropertyValue('height'),'','native expand reveals other rows');
  assert.equal(nested.label,'Split pane name','split pane title remains native and intact');
  assert.equal(group.groupContainer.hidden,false,'split host expanded');
  api.sync(group);await api.whenIdle(group);
  assert.deepEqual(calls,['collapse','expand'],'unchanged expanded host cannot restart layout animation');
  // Actual native re-entry adds/removes descendants while the host is open.
  // This must NOT call animateExpand for the already-visible host again.
  const newPane = tab('Incoming split pane',false,split);
  descendants.push(newPane);
  api.sync(group);await api.whenIdle(group);
  assert.deepEqual(calls,['collapse','expand'],
    'adding a split child must not replay native expand on an open host');
  newPane.selected=true;nested.selected=false;
  api.sync(group);await api.whenIdle(group);
  assert.deepEqual(calls,['collapse','expand'],
    'changing the active split pane must not replay open-group animation');
  descendants.pop();nested.selected=true;
  api.sync(group);await api.whenIdle(group);
  assert.deepEqual(calls,['collapse','expand'],
    'removing a split child must not replay native expand');
  // The entire native split wrapper exits the opened host, leaving a
  // normal group. This must not start an ordinary animateExpand either.
  hasSplit=false;descendants.pop();win.gBrowser.selectedTab=sibling;
  api.sync(group);await api.whenIdle(group);
  assert.deepEqual(calls,['collapse','expand'],
    'split exit to ordinary group must not replay native expand');
  hasSplit=true;descendants.push(nested);win.gBrowser.selectedTab=nested;
  api.sync(group);await api.whenIdle(group);
  assert.deepEqual(calls,['collapse','expand'],
    'split return to expanded host must not replay native expand');
  group.collapsed=true;api.sync(group);await api.whenIdle(group);
  assert.deepEqual(calls,['collapse','expand','collapse']);
  assert(/#tabbrowser-tabs tab-group\[split-view-group\]\s*\{\s*--zia-active-tab-bg:\s*var\(--zsf-selected-tab-fill/.test(css),
    'split group retains user-selected background color');
  console.log('PASS: split native collapse/expand, no negative margin on open, visible siblings, stable title and color');
})().catch(e=>{console.error(e);process.exitCode=1;});
