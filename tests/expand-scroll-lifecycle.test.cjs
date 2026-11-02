const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const completion = 'TabGroupAnimationComplete';
let finishExpand;
let calls = 0, delivered = 0;
const listeners = new Map();
const folderPrototype = {
  get activeGroups(){return [];}, get childActiveGroups(){return [];},
  get activeTabs(){return this._activeTabs;},set activeTabs(v){this._activeTabs=v;}
};
const window = {
  __ziaLoaded:true,addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(){},
  customElements:{get:()=>({prototype:folderPrototype})},
  CustomEvent:class {constructor(type,opts){this.type=type;Object.assign(this,opts);}},
  gBrowser:{tabContainer:{_invalidateCachedVisibleTabs(){},getAnimations:()=>[]}},
  gZenFolders:{animateExpand(){calls++;return new Promise(r=>finishExpand=r);},animateCollapse(){return Promise.resolve();}}
};
const document={readyState:'loading',documentElement:{removeAttribute(){}},getElementById:()=>null};
vm.runInNewContext(fs.readFileSync(path.join(base,'site-folders-collapse.uc.js'),'utf8')
  .replace('  function onTabSelect(event) {','  window.inspectComplete = onAnimationComplete;\n  function onTabSelect(event) {'),
  {window,document,console,queueMicrotask});
vm.runInNewContext(fs.readFileSync(path.join(base,'site-folders-drag.uc.js'),'utf8'),
  {window,document,console,setTimeout,clearTimeout,Promise});
const bridge=window.__zsfCollapseV037;
const group={isConnected:true,isZenFolder:false,pinned:false,collapsed:false,
  matches:()=>true,tabs:[{selected:true,multiselected:false,getAttribute:()=>null}],
  groupContainer:{hidden:false},dispatchEvent(e){deliver(this,e);}};
function deliver(target,e={type:completion}){
  e.target=target;e.stopImmediatePropagation=()=>e.stopped=true;
  window.inspectComplete(e);if(!e.stopped)delivered++;
  return e;
}
(async()=>{
  bridge.sync(group);
  assert(deliver(group).stopped,'early width completion must not release native overflow scroll guard');
  assert.equal(delivered,0);
  let mutationReady=false;
  const mutation=window.__zsfDragV037.beforeMutation(group).then(()=>mutationReady=true);
  await Promise.resolve();assert(!mutationReady,'drag/restore mutation must await actual vertical animation');
  finishExpand();await mutation;
  assert.equal(delivered,1);assert.equal(calls,1);assert(mutationReady);

  // Rapid restart: an old animation cannot release the newest guard.
  bridge.sync(group,true);const old=finishExpand;deliver(group);
  bridge.sync(group,true);const latest=finishExpand;
  old();await Promise.resolve();await Promise.resolve();assert.equal(delivered,1);
  latest();await bridge.whenIdle(group);assert.equal(delivered,2);

  // If animation already finished, the normal completion passes through.
  assert(!deliver(group).stopped);assert.equal(delivered,3);
  assert(!deliver({...group,matches:()=>false}).stopped,'other/native groups unaffected');
  assert.equal(delivered,4);
  console.log('PASS: defer premature completion, preserve drag beforeMutation/whenIdle, rapid reversal, native completion and unrelated-group pass-through.');
})().catch(error=>{console.error(error);process.exitCode=1;});
