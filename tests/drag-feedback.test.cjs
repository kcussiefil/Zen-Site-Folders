const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'site-folders-drag.uc.js'), 'utf8');
const core = fs.readFileSync(path.join(__dirname, '..', 'site-folders.uc.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'userChrome.css'), 'utf8');
new vm.Script(src);
assert(!/dropEffect\s*=/.test(src), 'never alter native drag effect');
assert((src.match(/event\.preventDefault\?\.\(\)/g)||[]).length===2 &&
       (src.match(/event\.stopPropagation\?\.\(\)/g)||[]).length===1,
  'group cancellation/drop may prevent default; native dragover is not stopped');
assert(src.includes('if (ziaDelegate)') &&
  src.includes('Let native dragover reach'),
  'normal Zen/Zia drop events must not be intercepted');
assert((src.match(/\.setDragImage\(/g)||[]).length===1,
  'only the ZSF-scoped OS preview may be overwritten, not native drop events');
assert(!/\.(?:pinTab|unpinTab|removeTab)\s*\(/.test(src),
  'drag must not pin or close tabs');
assert(!core.includes("window.addEventListener('TabGrouped'"),
  'user manual drag must not get silently undone by newest-first on TabGrouped');
assert(css.includes('.zsf-drag-ghost') && !css.includes('.zsf-drop-guide'));
assert(!src.includes('zsf-drop-guide'), 'remove redundant horizontal guide');
assert(css.includes('pointer-events: none !important'));

class Node {
  constructor(tag='div',className='') {
    this.localName=tag;this.className=className;this.children=[];this.parentElement=null;
    this.isConnected=true;this.attrs=new Map();
    const props=new Map();
    this.style={setProperty:(n,v)=>props.set(n,v),removeProperty:n=>props.delete(n),
      getPropertyValue:n=>props.get(n)||''};
    this.hidden=false;this.textContent='';
    this.box={left:20,top:100,right:470,bottom:135,width:450,height:35};
  }
  append(...nodes){for(const n of nodes){this.children.push(n);n.parentElement=this;}}
  appendChild(n){this.append(n);}
  remove(){this.isConnected=false;if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);}
  setAttribute(k,v){this.attrs.set(k,String(v));}
  removeAttribute(k){this.attrs.delete(k);}
  hasAttribute(k){return this.attrs.has(k);}
  getAttribute(k){return this.attrs.get(k)||null;}
  getBoundingClientRect(){return this.box;}
  get offsetWidth(){return 178;}
  get offsetHeight(){return 42;}
  matches(sel){
    if(sel==='tab-group[data-zsf-site]:not([split-view-group])')
      return this.localName==='tab-group'&&this.hasAttribute('data-zsf-site');
    if(sel==='tab-group:not([split-view-group])')return this.localName==='tab-group';
    return false;
  }
  closest(selector){
    if(selector==='.tab-group-label-container'&&this.className==='tab-group-label-container')return this;
    if(selector==='.tabbrowser-tab'&&this.localName==='tab')return this;
    if(selector==='zen-workspace'&&this.localName==='zen-workspace')return this;
    return this.parentElement?.closest(selector)||null;
  }
  querySelector(sel) {
    if(sel===':scope > .tab-group-label-container')
      return this.children.find(n=>n.className==='tab-group-label-container')||null;
    const name=sel.match(/\.([a-z][\w-]*)$/i)?.[1];
    if(name){
      const dive=node=>node.children.find(n=>n.className?.split(' ').includes(name))||node.children.map(dive).find(Boolean);
      return dive(this)||null;
    }
    return null;
  }
  querySelectorAll(selector) {
    if(selector==='tab') {
      const out=[];
      const visit=node=>{for(const child of node.children){if(child.localName==='tab')out.push(child);visit(child);}};
      visit(this);return out;
    }
    return [];
  }
}
const events=new Map();const callbacks={};
function on(target,name,fn){const key=target.localName+':'+name;(events.get(key)||events.set(key,[]).get(key)).push(fn);}
function off(target,name,fn){const key=target.localName+':'+name;events.set(key,(events.get(key)||[]).filter(x=>x!==fn));}
function emit(target,name,data) {for(const fn of events.get(target.localName+':'+name)||[])fn(data);}
const root=new Node('root');
const strip=new Node('strip');
const sidebar=new Node('sidebar');
sidebar.box={left:0,top:0,right:508,bottom:800,width:508,height:800};
const space=new Node('zen-workspace');
const separator=new Node('separator');
separator.box={left:0,top:65,right:500,bottom:90,width:500,height:25};
space.querySelector=selector=>selector.includes('pinned-tabs-container-separator')?separator:null;
root.append(sidebar,strip,space);
space.append(strip);
const first=new Node('tab-group'),source=new Node('tab-group'),last=new Node('tab-group');
for(const g of [first,source,last])g.setAttribute('data-zsf-site','true');
strip.append(first,source,last);
function header(group,name,top){
  const label=new Node('hbox','tab-group-label-container');
  label.box={left:10,top,right:480,bottom:top+35,width:470,height:35};
  group.box={...label.box};
  const title=new Node('label','tab-group-label');title.textContent=name;
  label.append(title);group.append(label);return label;
}
header(first,'About',105);
const sourceLabel=header(source,'GitHub',145);
header(last,'YouTube',185);
const moveLog=[];
function move(sourceNode,targetNode,before){
  assert(sourceNode.isConnected&&targetNode.isConnected);
  assert.equal(sourceNode.parentElement,targetNode.parentElement,'move only same container');
  const array=sourceNode.parentElement.children;
  array.splice(array.indexOf(sourceNode),1);
  array.splice(array.indexOf(targetNode)+(before?0:1),0,sourceNode);
  // Native Zen relayouts the actual tab rows after moving them. Simulate
  // refreshed row geometry or the next pointer target would hit stale rows.
  if (sourceNode.localName === 'tab') {
    array.filter(n => n.localName === 'tab').forEach((tab, i) => {
      tab.box = { ...tab.box, top: 165 + i * 35, bottom: 199 + i * 35 };
    });
  }
  moveLog.push({sourceNode,targetNode,before});
}
const rafs=new Map();let rafId=0;
const window={localName:'window',innerWidth:1024,innerHeight:800,
  requestAnimationFrame(fn){rafs.set(++rafId,fn);return rafId;},
  cancelAnimationFrame(id){rafs.delete(id);},
  addEventListener(name,fn){on(this,name,fn);},
  removeEventListener(name,fn){off(this,name,fn);},
  gBrowser:{
    moveTabBefore(a,b){move(a,b,true);},
    moveTabAfter(a,b){move(a,b,false);},
  }};
strip.addEventListener=(name,fn)=>on(strip,name,fn);
strip.removeEventListener=(name,fn)=>off(strip,name,fn);
const doc={readyState:'complete',documentElement:root,
  getElementById:id=>id==='tabbrowser-tabs'?strip:id==='navigator-toolbox'?sidebar:null,
  createElementNS:(ns,name)=>new Node(name)};
vm.runInNewContext(src,{window,document:doc,console,setTimeout,clearTimeout});
const api=window.__zsfDragV037;
assert(api&&api.version==='0.6.6');
const gEvent=(x,y,target=sourceLabel)=>({
  button:0,buttons:1,clientX:x,clientY:y,target,composedPath:()=>[target,source]
});
async function waitNative(){await new Promise(resolve=>setTimeout(resolve,80));}
async function main(){
  const initial=strip.children.slice();
  emit(strip,'mousedown',gEvent(160,160));
  emit(window,'mousemove',gEvent(161,162));
  assert.equal(root.querySelector('.zsf-drag-ghost'),null,'tiny movement should not start drag');
  emit(window,'mousemove',gEvent(160,95));
  const ghost=root.querySelector('.zsf-drag-ghost');
  assert(ghost && !root.querySelector('.zsf-drop-guide'),
    'group preview must use exactly one card and the native-style gap');
  assert(ghost.hasAttribute('data-zsf-docked'),
    'group ghost must be docked IN the displaced target row, not by the pointer');
  assert.equal(ghost.style.top, '105px',
    'moving folder above first group must show the final insertion position immediately');
  assert.equal(ghost.style.height, '35px',
    'the visible landing preview must use the SAME row pitch as avoidance');
  assert(css.includes('.zsf-drag-ghost[data-zsf-docked]') &&
    css.includes('transition: none !important'),
    'dock must follow Zia-style immediate transforms without its own lag');
  assert(root.hasAttribute('data-zsf-hide-native-indicator'),
    'owned group drag hides native grey drop line with circle endcaps');
  assert(css.includes('#zen-drag-indicator') && css.includes('visibility: hidden !important'),
    'Zen DOM drop indicator must be hidden while ZSF guide is shown');
  assert.equal(ghost.getAttribute('aria-hidden'),'true');
  assert.deepEqual(strip.children,initial,'visual drag must not reorder until drop');
  assert(first.hasAttribute('data-zsf-drag-avoid') &&
    first.style.getPropertyValue('--zsf-drag-avoid-y')==='35px',
    'dragging whole folder above first must animate first sibling downward');
  assert(last.style.getPropertyValue('--zsf-drag-avoid-y')==='0px',
    'unaffected siblings must not move');
  assert(source.hasAttribute('data-zsf-drag-source'),
    'source must be visibly represented by floating card, not a native grey bar');
  let blankImage=null;
  emit(window,'dragstart',{...gEvent(160,95),
    dataTransfer:{setDragImage(node){blankImage=node;}}});
  assert(blankImage?.className==='zsf-native-blank-drag',
    'OS drag image must be replaced only for an owned source');
  // Actual fix, not just an insertion-line illustration.
  emit(window,'drop',gEvent(160,95));
  await Promise.resolve();
  assert.deepEqual(strip.children,[source,first,last],
    'whole folder must move immediately without waiting for animation idle');
  await waitNative();
  assert.deepEqual(strip.children,[source,first,last],
    'GitHub group must reach top of ordinary tab list');
  assert.equal(moveLog.length,1,'use native browser moveTabBefore exactly once');
  await new Promise(resolve=>setTimeout(resolve,90));
  assert(!ghost.isConnected,'landed preview cleans itself after a short frame bridge');
  assert(!root.hasAttribute('data-zsf-hide-native-indicator'),
    'native indicator mask must clear after drop');
  assert(!first.hasAttribute('data-zsf-drag-avoid') &&
    !first.style.getPropertyValue('--zsf-drag-avoid-y'),
    'group avoidance styles must be removed after drop');
  // An already-correct native result must not get moved twice.
  assert.equal(api.commit({kind:'group',source,target:first,before:true},
    {kind:'group',parent:strip}),true);
  assert.equal(moveLog.length,1,'skip duplicate correction if Zen/Zia already moved');

  // Pointer-only gestures on macOS may have mouseup without a drop event.
  emit(strip,'mousedown',gEvent(160,160));
  emit(window,'mousemove',gEvent(160,129));
  assert.deepEqual(strip.children,[source,first,last],
    'visual group avoidance must not mutate the real DOM on mousemove');
  emit(window,'mouseup',gEvent(160,129));
  await Promise.resolve();
  assert.deepEqual(strip.children,[first,source,last],
    'pointer-only mouseup must finish the group reorder immediately');
  assert(api.commit({kind:'group',source,target:first,before:true},
    {kind:'group',parent:strip}), 'reset fixture to original order');

  // Explicit out-of-sidebar drop must never move/pin a group.
  emit(strip,'mousedown',gEvent(160,111));
  emit(window,'mousemove',gEvent(160,135));
  emit(window,'drop',gEvent(800,300));
  await waitNative();
  assert.deepEqual(strip.children,[source,first,last]);

  // Member order: native TabGrouped had been re-sorting the dragged tab after
  // 80ms. Now user-directed A,B,C -> B,A,C must remain stable.
  const container=new Node('vbox','tab-group-container');
  source.append(container);
  const members=['A','B','C'].map((name,i)=>{
    const tab=new Node('tab','tabbrowser-tab');
    tab.group=source;tab.textContent=name;
    tab.box={left:48,top:165+i*35,right:460,bottom:199+i*35,width:412,height:34};
    return tab;
  });
  container.append(...members);
  const [A,B,C]=members;
  const tabEvent=(x,y,target=B)=>({
    button:0,buttons:1,clientX:x,clientY:y,target,
    composedPath:()=>[target,container,source]
  });
  const subject={kind:'tab',item:B,parent:source,container};
  const slot=api.chooseSlot(subject,100,180);
  assert(slot&&slot.target===A&&slot.before,
    'dragging B above first member must resolve before A');
  assert(api.commit(slot,subject),'native reorder should succeed');
  assert.deepEqual(container.children,[B,A,C],
    'member order must follow manual drag even if native drag handler missed it');
  assert(A.group===source&&B.group===source&&C.group===source,
    'member reordering must never ungroup or close a page');
  assert.equal(api.chooseSlot(subject,900,170),null,'invalid x must refuse reorder');

  // Real pointer gesture for a member, without pin or group changes.
  emit(strip,'mousedown',tabEvent(100,245,C));
  emit(window,'mousemove',tabEvent(100,180,C));
  const memberGhost=root.querySelector('.zsf-drag-ghost');
  assert(memberGhost,'member drag should also have a visible preview');
  assert(root.hasAttribute('data-zsf-hide-native-indicator'),
    'individual member drag also suppresses the circular-ended grey indicator');
  emit(window,'drop',tabEvent(100,180,C));
  await Promise.resolve();
  assert.deepEqual(container.children,[C,B,A],
    'member drop must take effect immediately without waiting for animation idle');
  await waitNative();
  assert.deepEqual(container.children,[C,B,A],
    'native fallback must support member moving to group start');
  assert(!memberGhost.isConnected,'member ghost removed on drop');
  assert(css.includes('.tabbrowser-tab[data-zsf-drag-member]') &&
    css.includes('opacity: 0 !important'),
    'dragged member must not keep original grey source row');
  assert(!src.includes("window.addEventListener('TabGrouped'"));
  // A normal Zen workspace switch need not emit ZenWorkspacesUIUpdate.
  // The pending transaction must check the actual workspace identity too.
  window.gZenWorkspaces = { activeWorkspace: 'space1' };
  const beforeSwitch = container.children.slice();
  emit(strip, 'mousedown', tabEvent(100,210,B));
  emit(window, 'mousemove', tabEvent(100,180,B));
  emit(window, 'drop', tabEvent(100,180,B));
  window.gZenWorkspaces.activeWorkspace = 'space2';
  await waitNative();
  assert(container.children.every((tab, i) => tab === beforeSwitch[i]),
    'a workspace switch without UI notification must invalidate pending correction');
  // A real Zen arrowscrollbox need not be in the pointer event path.
  const port=new Node('scrollbox');
  port.scrollTop=110;port.scrollHeight=1000;port.clientHeight=320;
  port.box={left:0,top:80,right:500,bottom:400,width:500,height:320};
  space.scrollbox={scrollbox:port};
  emit(strip,'mousedown',gEvent(160,160,sourceLabel));
  emit(window,'mousemove',gEvent(160,390,sourceLabel));
  assert(rafs.size>0,'drag at bottom of actual scrollport schedules auto-scroll');
  for(let i=0;i<8;i++){
    const item=[...rafs][0];if(!item)break;
    rafs.delete(item[0]);item[1]();
  }
  assert(port.scrollTop>110,'bottom-edge drag must scroll down without moving tabs');
  const afterDown=port.scrollTop;
  emit(window,'mousemove',gEvent(160,90,sourceLabel));
  for(let i=0;i<8;i++){
    const item=[...rafs][0];if(!item)break;
    rafs.delete(item[0]);item[1]();
  }
  assert(port.scrollTop<afterDown,'top-edge drag must scroll up');
  emit(window,'keydown',{key:'Escape'});
  assert.equal(rafs.size,0,'Esc cancels any pending scroll frames');
  assert(!first.hasAttribute('data-zsf-drag-avoid'),'Esc clears avoidance flags');
  // A dragstart from an unrelated regular tab must not blank its OS image.
  let unrelatedBlanked=false;
  const outsideTab=new Node('tab','tabbrowser-tab');
  outsideTab.parentElement=strip;
  emit(window,'dragstart',{...tabEvent(100,180,outsideTab),
    composedPath:()=>[outsideTab,strip],
    dataTransfer:{setDragImage(){unrelatedBlanked=true;}}});
  assert(!unrelatedBlanked,'unrelated native drag preview must stay intact');

  // Native takeover must clear the pointer fallback synchronously, even
  // if no dragover follows before the scrollport moves.
  emit(strip,'mousedown',tabEvent(100,180,A));
  emit(window,'mousemove',tabEvent(100,215,A));
  assert(A.hasAttribute('data-zsf-drag-member'));
  root.setAttribute('zia-dragging-tab','true');
  A.setAttribute('zia-dragging','true');
  emit(window,'dragstart',{...tabEvent(100,215,A),dataTransfer:{}});
  assert(!A.hasAttribute('data-zsf-drag-member'),
    'native dragstart must immediately unhide the tab without waiting for dragover');
  assert(!root.querySelector('.zsf-drag-ghost'), 'native tab must have only Zia visuals');
  emit(window,'dragend',{});
  root.removeAttribute('zia-dragging-tab');
  A.removeAttribute('zia-dragging');

  // Zia mode waits for native dragstart without a competing hidden source.
  window.__ziaLoaded = true;
  emit(strip,'mousedown',{...gEvent(160,160),isTrusted:true});
  emit(window,'mousemove',{...gEvent(160,120),isTrusted:true});
  assert.equal(api.debugDrag(source).activeKind,null);
  assert.equal(api.debugDrag(source).ziaDelegate,false);
  assert(!source.hasAttribute('data-zsf-drag-source'));
  root.setAttribute('zia-dragging-tab','true');
  emit(window,'dragstart',{...gEvent(160,120),dataTransfer:{}});
  assert.equal(api.debugDrag(source).ziaDelegate,true);
  assert.equal(api.debugDrag(source).activeKind,null);
  assert(!source.hasAttribute('data-zsf-drag-source'));
  root.removeAttribute('zia-dragging-tab');
  emit(window,'keydown',{key:'Escape'});
  assert(!source.isZenFolder);

  // Zia's deferred startup can register its capture handler AFTER ours.
  window.__ziaLoaded = true;
  const lateZiaStart = () => { if(source.isZenFolder)root.setAttribute('zia-dragging-tab','true'); };
  window.addEventListener('dragstart',lateZiaStart,true);
  const originalMoveBefore=window.gBrowser.moveTabBefore;
  let lateLandingGuarded=false;
  const lateZiaDrop=()=>setTimeout(()=>{lateLandingGuarded=window.gBrowser.moveTabBefore!==originalMoveBefore;},0);
  window.addEventListener('drop',lateZiaDrop,true);
  emit(strip,'mousedown',gEvent(160,160,sourceLabel));
  let cancelledLateStart=false;
  emit(window,'dragstart',{...gEvent(160,160,sourceLabel),
    composedPath:()=>[sourceLabel,source,strip],
    preventDefault(){cancelledLateStart=true;},dataTransfer:{}});
  assert.equal(cancelledLateStart,false,'late Zia listener must run before the handoff can cancel');
  assert.equal(api.debugDrag(source).ziaDelegate,true,'late-installed Zia must claim the prepared group');
  emit(window,'drop',gEvent(160,140,sourceLabel));
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(lateLandingGuarded,true,'late-installed Zia landing must run before adapter cleanup');
  emit(window,'keydown',{key:'Escape'});
  root.removeAttribute('zia-dragging-tab');
  window.removeEventListener('dragstart',lateZiaStart,true);
  window.removeEventListener('drop',lateZiaDrop,true);

  // Temporary Zia group hand-off: the normal JS unit fixture emulates
  // the flag Zia sets during its own window-capture dragstart.
  window.__ziaLoaded = true;
  const nativeBefore = moveLog.length;
  emit(strip,'mousedown',gEvent(160,160,sourceLabel));
  assert(api.prepareZiaGroupDrag(source) === true,
    'isolated synthetic Zia regression explicitly primes native adapter');
  assert(source.isZenFolder === true,
    'only the grabbed ZSF group may be temporarily recognized by Zia');
  root.setAttribute('zia-dragging-tab','true');
  emit(window,'dragstart',{...gEvent(160,160,sourceLabel),
    composedPath:()=>[sourceLabel,source,strip],
    dataTransfer:{setDragImage(){throw Error('ZSF must not override Zia drag image');}}});
  assert(!root.querySelector('.zsf-drag-ghost'),
    'no duplicate drag preview when Zia has taken over a whole group');
  emit(window,'drop',gEvent(160,140,sourceLabel));
  await new Promise(resolve=>setTimeout(resolve,60));
  assert(source.isZenFolder !== true,
    'temporary native folder identity must be restored after drop');
  assert.equal(moveLog.length,nativeBefore,
    'without a native insertion there must be no delayed safety reorder');
  root.removeAttribute('zia-dragging-tab');
  window.__ziaLoaded = false;

  // Zia implements its own native tab row displacement and target
  // calculation. Our preview MUST disappear when Zia starts that drag,
  // otherwise our CSS masks Zia's actual moving row.
  const ziaOrder = container.children.slice();
  emit(strip,'mousedown',tabEvent(100,175,C));
  emit(window,'mousemove',tabEvent(100,202,C));
  const duplicate = root.querySelector('.zsf-drag-ghost');
  assert(duplicate && !duplicate.hidden, 'fixture starts the custom fallback preview');
  root.setAttribute('zia-dragging-tab','true');
  emit(window,'dragover',tabEvent(100,210,C));
  assert(duplicate.hidden && !C.hasAttribute('data-zsf-drag-member'),
    'native Zia drag must stay visible and its own visual position authoritative');
  const beforeNativeRelease = moveLog.length;
  emit(window,'drop',tabEvent(100,180,C));
  await waitNative();
  assert.equal(moveLog.length,beforeNativeRelease,
    'custom drag must not reorder native Zia member tabs a second time');
  assert.deepEqual(container.children,ziaOrder,
    'without a mocked Zia drop, our delegated path must not mutate the DOM');
  root.removeAttribute('zia-dragging-tab');
  assert(api.commit({kind:'group',source,target:first,before:true},
    {kind:'group',parent:strip}), 'restore native-test source ordering');

  // The gap math must also work when moving DOWN, where Zia shifts
  // intervening rows upward. The preview must already occupy the exact
  // final landing position; mouseup/drop cannot invent a different slot.
  assert.deepEqual(strip.children,[source,first,last],
    'group fixture begins above its sibling folders');
  emit(strip,'mousedown',gEvent(160,160,sourceLabel));
  emit(window,'mousemove',gEvent(160,219,sourceLabel));
  const downGhost=root.querySelector('.zsf-drag-ghost');
  assert(downGhost?.hasAttribute('data-zsf-docked'),
    'moving a folder downward must also display a docked final row');
  assert.equal(downGhost.style.top,'185px',
    'the gap after last is last.bottom minus one displaced pitch');
  assert.equal(last.style.getPropertyValue('--zsf-drag-avoid-y'),'-35px',
    'downward drag must move the intervening target row upward');
  assert.deepEqual(strip.children,[source,first,last],
    'even a live docked preview must not change DOM before release');
  emit(window,'drop',gEvent(160,219,sourceLabel));
  await Promise.resolve();
  assert.deepEqual(strip.children,[first,last,source],
    'dropping at the visible end slot must immediately confirm the same order');
  await new Promise(resolve=>setTimeout(resolve,90));

  api.destroy();
  assert.equal((events.get('window:mousemove')||[]).length,0,'no leaked listeners');
  console.log('PASS: native grey picture suppression, group sibling avoidance, edge autoscroll, original drag safety and cleanup');
}
main().catch(err=>{console.error(err);process.exitCode=1});
