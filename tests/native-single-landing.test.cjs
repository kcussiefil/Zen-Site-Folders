const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname+'/../site-folders-drag.uc.js','utf8');
let frames=0, cancels=0;
const nav={getBoundingClientRect:()=>({left:0,right:300,bottom:900})};
const root={hasAttribute:()=>false,removeAttribute(){}};
const document={readyState:'loading',documentElement:root,getElementById:id=>id==='navigator-toolbox'?nav:null};
const window={__ziaLoaded:true,gZenWorkspaces:{activeWorkspace:'test'},
  addEventListener(){},removeEventListener(){},
  requestAnimationFrame(){return ++frames;},cancelAnimationFrame(){cancels++;}};
vm.runInNewContext(source.replace('  window.__zsfDragV037 = api;',`
  window.probe={primeZiaShim,restoreZiaShim,captureZiaGap,onMove,onStart,onOver,finish,reset,autoScrollTick,
    delegate(value){ziaDelegate=value;},
    context:()=>ziaShim?.landingContext,
    pending(value){pending=value;},
    scroll(value,pointer){active=value;autoPointer=pointer;},
    state:()=>({active,pending,ghost})};
  window.__zsfDragV037 = api;`),
  {window,document,console,setTimeout,clearTimeout,Promise});
const p=window.probe;
function node(name){return {name,localName:'tab-group',isConnected:true,pinned:false,tabs:[],
  matches:()=>true,hasAttribute:()=>false,
  querySelector(){return this.label;},
  get nextElementSibling(){const a=this.parentElement?.children||[];return a[a.indexOf(this)+1]||null;}};}
function fixture(){
  const calls=[];
  const parent={isConnected:true,children:[],insertBefore(n,b){
    calls.push({host:this,n,b});
    if(n.parentElement)n.parentElement.children=n.parentElement.children.filter(x=>x!==n);
    const i=b?this.children.indexOf(b):this.children.length;
    this.children.splice(i,0,n);n.parentElement=this;return n;}};
  const pinned={...parent,children:[]};
  const separator={parentNode:pinned,getBoundingClientRect:()=>({bottom:100})};
  const workspace={querySelector:()=>separator};
  const rows=['A','source','B','C'].map(node),group=rows[1];
  for(const n of rows){n.parentElement=parent;n.closest=()=>workspace;}
  parent.children=rows.slice();
  window.gBrowser={moveTabBefore(n,b){b.parentNode.insertBefore(n,b);},moveTabAfter(){throw Error('unexpected native move');}};
  const native=window.gBrowser.moveTabBefore,insert=parent.insertBefore;
  assert(p.primeZiaShim({kind:'group',item:group}));
  return {parent,pinned,separator,group,rows,calls,native,insert};
}
for(const direction of ['up','down']){
  const f=fixture();
  const shifted=direction==='up'?[f.rows[0]]:f.rows.slice(2);
  for(const n of shifted){n.hasAttribute=key=>key==='zia-shift';n.style={getPropertyValue:()=>direction==='up'?'40':'-40'};}
  p.captureZiaGap(p.context());
  // While previewing, even an unexpected insertion is refused in place.
  f.pinned.insertBefore(f.group,f.separator);assert.equal(f.calls.length,0);
  p.context().accepted=true;
  window.gBrowser.moveTabBefore(f.group,f.separator);
  f.pinned.insertBefore(f.group,f.separator); // Zia's DOM fallback must not insert twice.
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].host,f.parent);
  assert.equal(f.parent.children.map(n=>n.name).join(','),direction==='up'?'source,A,B,C':'A,B,C,source');
  p.restoreZiaShim();assert.equal(window.gBrowser.moveTabBefore,f.native);assert.equal(f.parent.insertBefore,f.insert);
  assert(!Object.hasOwn(f.group,'isZenFolder'));
}
{
  const f=fixture();p.context().landingBefore={isConnected:false};p.context().accepted=true;
  f.pinned.insertBefore(f.group,f.separator);
  assert.equal(f.calls.length,0);assert.equal(f.group.parentElement,f.parent);p.restoreZiaShim();
}
{
  const f=fixture();window.gZenWorkspaces.activeWorkspace='other';p.context().accepted=true;
  f.pinned.insertBefore(f.group,f.separator);assert.equal(f.calls.length,0);
  window.gZenWorkspaces.activeWorkspace='test';p.restoreZiaShim();
}
// Zia owns a member gesture from its start, before native dragstart fires.
p.pending({item:{isConnected:true},x:0,y:0});p.onMove({buttons:1,clientX:100,clientY:100});
assert.equal(p.state().active,null);assert.equal(p.state().ghost,null);p.reset();
p.pending({kind:'tab',item:{isConnected:true},layout:{}});
p.onStart({composedPath:()=>[]});assert.equal(p.state().active,null);assert.equal(p.state().ghost,null);
// Non-Zia edge-scroll fallback remains functional in both directions and cancels.
window.__ziaLoaded=false;
const port={scrollTop:200,scrollHeight:2000,clientHeight:800,
 getBoundingClientRect:()=>({left:0,right:250,top:100,bottom:900}),scrollTo({top}){this.scrollTop=top;}};
const subject={kind:'tab',scrollPort:port,item:{closest:()=>null}};
p.scroll(subject,{x:120,y:890});p.autoScrollTick();assert(port.scrollTop>200);
p.scroll(subject,{x:120,y:105});const before=port.scrollTop;p.autoScrollTick();assert(port.scrollTop<before);
p.reset();assert(cancels>0);
(async()=>{
for(const allowed of [true,false]){
  window.__ziaLoaded=true;
  const f=fixture(),context=p.context();
  Object.assign(context,{kind:'group',item:f.group});p.delegate(context);
  const row=f.rows[2];row.hasAttribute=key=>key==='zia-shift';row.style={getPropertyValue:()=>'-40'};
  p.onOver({clientX:120,clientY:allowed?850:20,
    preventDefault(){throw Error('native scroll intercepted');},
    stopPropagation(){throw Error('native scroll intercepted');}});
  // Real Zia registers its drop capture listener first and queues its
  // insertion before our cleanup. No second reorder is queued by ZSF.
  setTimeout(()=>{
    window.gBrowser.moveTabBefore(f.group,f.separator);
    f.pinned.insertBefore(f.group,f.separator);
  },0);
  // Zia clears its shifts during drop before the adapter runs.
  row.hasAttribute=()=>false;
  p.finish({clientX:120,clientY:20,preventDefault(){},stopPropagation(){}});
  // No intermediate paint of the old order after native preview cleanup.
  assert.equal(f.calls.length,allowed?1:0,'landing must finish in the drop dispatch');
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(f.calls.length,allowed?1:0);
  if(allowed)assert.equal(f.group.nextElementSibling,f.rows[3]);
  assert.equal(f.group.parentElement,f.parent);
  assert.equal(window.gBrowser.moveTabBefore,f.native);
}
console.log('PASS: one insertion up/down, no pinned insertion, invalid/stale cancellation, cleanup, no pre-native card, fallback edge scroll up/down, native dragover propagation, queued native landing and painted-slot freeze.');
})().catch(error=>{console.error(error);process.exitCode=1;});
