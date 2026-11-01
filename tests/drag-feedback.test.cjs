const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'site-folders-drag.uc.js'), 'utf8');
const core = fs.readFileSync(path.join(__dirname, '..', 'site-folders.uc.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'userChrome.css'), 'utf8');
new vm.Script(src);
assert(!/\bpreventDefault\(|\bstopPropagation\(|dropEffect\s*=/.test(src),
  'must never interrupt native Zen/Zia drop events');
assert((src.match(/\.setDragImage\(/g)||[]).length===1,
  'only the ZSF-scoped OS preview may be overwritten, not native drop events');
assert(!/\.(?:pinTab|unpinTab|removeTab)\s*\(/.test(src),
  'drag must not pin or close tabs');
assert(!core.includes("window.addEventListener('TabGrouped'"),
  'user manual drag must not get silently undone by newest-first on TabGrouped');
assert(css.includes('.zsf-drag-ghost') && !css.includes('.zsf-drop-guide'));
assert(!src.includes("create('div', 'zsf-drop-guide')"), 'no duplicated drop guide element');
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
assert(api&&api.version==='0.5.1');
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
  assert(ghost && !root.querySelector('.zsf-drop-guide'),'drag uses floating card without duplicated horizontal guide');
  assert.deepEqual(strip.children,[source,first,last],
    'whole-folder live preview must reorder the actual DOM before drop');
  assert(root.hasAttribute('data-zsf-hide-native-indicator'),
    'owned group drag hides native grey drop line with circle endcaps');
  assert(css.includes('#zen-drag-indicator') && css.includes('visibility: hidden !important'),
    'Zen DOM drop indicator must be hidden while ZSF guide is shown');
  assert.equal(ghost.getAttribute('aria-hidden'),'true');
  assert.notDeepEqual(strip.children,initial,'live preview should reorder before drop');
  assert(!first.hasAttribute('data-zsf-drag-avoid'),
    'real live DOM ordering must not compete with an additional avoidance transform');
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
  assert.equal(moveLog.length,1,'native move happens once during live preview');
  assert(!ghost.isConnected,'drop cleans floating preview');
  assert(!root.hasAttribute('data-zsf-hide-native-indicator'),
    'native indicator mask must clear after drop');
  assert(!first.hasAttribute('data-zsf-drag-avoid'),
    'no avoid styles retained after live drop');
  // An already-correct native result must not get moved twice.
  assert.equal(api.commit({kind:'group',source,target:first,before:true},
    {kind:'group',parent:strip}),true);
  assert.equal(moveLog.length,1,'skip duplicate correction if Zen/Zia already moved');

  // Explicit out-of-sidebar drop must never move/pin a group.
  emit(strip,'mousedown',gEvent(160,111));
  emit(window,'mousemove',gEvent(160,135));
  emit(window,'drop',gEvent(800,300));
  await waitNative();
  assert.deepEqual(strip.children.map(n=>n===source?'source':n===first?'first':'last'),
    ['source','first','last'], 'cancelled out-of-sidebar live drag must restore source before first');

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
  emit(strip,'mousedown',tabEvent(100,175,C));
  emit(window,'mousemove',tabEvent(100,202,C));
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
  assert.notDeepEqual(container.children,beforeSwitch,
    'new live drag must update the DOM before dropping');
  emit(window, 'drop', tabEvent(100,180,B));
  await Promise.resolve();
  const acceptedOrder = container.children.slice();
  window.gZenWorkspaces.activeWorkspace = 'space2';
  await waitNative();
  assert(container.children.every((tab, i) => tab === acceptedOrder[i]),
    'workspace switch must not permit a late correction after accepted live drop');
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
  assert(!first.hasAttribute('data-zsf-drag-avoid'),'Esc leaves no avoidance flags');
  // A dragstart from an unrelated regular tab must not blank its OS image.
  let unrelatedBlanked=false;
  const outsideTab=new Node('tab','tabbrowser-tab');
  outsideTab.parentElement=strip;
  emit(window,'dragstart',{...tabEvent(100,180,outsideTab),
    composedPath:()=>[outsideTab,strip],
    dataTransfer:{setDragImage(){unrelatedBlanked=true;}}});
  assert(!unrelatedBlanked,'unrelated native drag preview must stay intact');
  api.destroy();
  assert.equal((events.get('window:mousemove')||[]).length,0,'no leaked listeners');
  console.log('PASS: native grey picture suppression, group sibling avoidance, edge autoscroll, original drag safety and cleanup');
}
main().catch(err=>{console.error(err);process.exitCode=1});
