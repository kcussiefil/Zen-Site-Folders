const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
let now=1000,frame=0;
const rafs=new Map(),calls=[];
function target(){return {handlers:[],addEventListener(type,fn,capture){this.handlers.push({type,listenerObject:fn,capturing:capture});},
 removeEventListener(type,fn){this.handlers=this.handlers.filter(h=>h.type!==type||h.listenerObject!==fn);}};}
const nav={getBoundingClientRect:()=>({x:0,y:100,left:0,right:300,top:100,bottom:900,width:300,height:800})};
const strip=target();
const root={hasAttribute:()=>true,removeAttribute(){}};
const document={readyState:'loading',documentElement:root,querySelector:()=>null,
 getElementById:id=>id==='navigator-toolbox'?nav:id==='tabbrowser-tabs'?strip:null};
const window=Object.assign(target(),{gZenWorkspaces:{activeWorkspace:'test'},
 requestAnimationFrame(fn){rafs.set(++frame,fn);return frame;},cancelAnimationFrame(id){rafs.delete(id);}});
const port={scrollTop:300,scrollHeight:2400,clientHeight:800,
 getBoundingClientRect:nav.getBoundingClientRect,scrollTo({top}){this.scrollTop=top;}};
const drag={clientY:200,firstTop:100};
function pointerOf(e){return {y:e.clientY};}
function apply(dy){calls.push({dy});}
function nativeOver(event){
 const dy=event.clientY - drag.clientY;
 const p=pointerOf(event);if(p.y<drag.firstTop){}
 apply(dy);Object.assign(calls.at(-1),{pointer:p.y,bounds:nav.getBoundingClientRect().top});
 event.preventDefault();
}
window.addEventListener('dragover',nativeOver,true);
strip.addEventListener('dragover',nativeOver,true);
const Cc={'@mozilla.org/eventlistenerservice;1':{getService:()=>({getListenerInfoFor:host=>host.handlers})}};
const Ci={nsIEventListenerService:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../site-folders-drag.uc.js'),'utf8')
 .replace('  window.__zsfDragV037 = api;',`window.probe={installZiaScrollBridge,stopZiaScrollBridge,onOver,autoScrollTick,finish,
  delegate(c){ziaDelegate=c;},bridge:()=>ziaScrollBridge};window.__zsfDragV037=api;`),
 {window,document,Cc,Ci,console,setTimeout,clearTimeout,Proxy,Reflect,Date:class extends Date{static now(){return now;}}});
const p=window.probe;
const emit=e=>{for(const h of [...window.handlers])if(h.type==='dragover')h.listenerObject(e);};
for(const [direction,y]of [['down',890],['up',105]]){
 port.scrollTop=direction==='down'?300:900;
 const start=port.scrollTop;
 const context={kind:'tab',item:{isConnected:true,closest:()=>null},workspace:'test',scrollPort:port};
 p.delegate(context);assert.equal(p.installZiaScrollBridge(context),true);
 let prevented=0;const event={clientX:120,clientY:y,screenY:y+30,preventDefault(){prevented++;}};
 emit(event);p.autoScrollTick();
 const delta=port.scrollTop-start;
 assert(direction==='down'?delta>0:delta<0,'scroll in requested direction');
 assert.equal(calls.at(-1).dy,y-200+delta,'native renderer uses compensated scroll displacement');
 assert.equal(calls.at(-1).pointer,y+delta);
 assert.equal(calls.at(-1).bounds,100+delta,'physical hit boxes use same coordinate frame');
 assert.equal(nav.getBoundingClientRect().top,100,'temporary geometry wrapper removed');
 assert.equal(event.clientY,y,'original trusted-event coordinates unchanged');
 assert(prevented>=2,'original callback and event methods remain functional');
 // A translated drag card is overflow, not additional scrollable content.
 const initialHeight=p.bridge().contentHeight;
 port.scrollHeight=initialHeight+5000;port.scrollTop=initialHeight-port.clientHeight;
 p.bridge().expectedTop=port.scrollTop;
 if(direction==='down'){const limit=port.scrollTop;p.autoScrollTick();assert.equal(port.scrollTop,limit,'ignore transformed overflow');}
 port.scrollHeight=initialHeight;
 // Existing native/user scrolling wins; the helper does not add another step.
 port.scrollTop+=25;const external=port.scrollTop;p.autoScrollTick();assert.equal(port.scrollTop,external);
 now+=130;p.autoScrollTick();assert.notEqual(port.scrollTop,external,'assistance resumes after native scrolling stops');
 const beforeCancel=port.scrollTop;
 p.finish({});p.autoScrollTick();assert.equal(port.scrollTop,beforeCancel,'drop stops scrolling');
 assert(window.handlers.some(h=>h.listenerObject===nativeOver));
 assert(strip.handlers.some(h=>h.listenerObject===nativeOver));
 assert.equal(p.bridge(),null);
}
// Workspace changes cannot continue a stale gesture.
const context={kind:'tab',item:{isConnected:true,closest:()=>null},workspace:'test',scrollPort:port};
p.delegate(context);p.installZiaScrollBridge(context);emit({clientX:120,clientY:890,screenY:920,preventDefault(){}});
window.gZenWorkspaces.activeWorkspace='other';const before=port.scrollTop;p.autoScrollTick();assert.equal(port.scrollTop,before);
p.stopZiaScrollBridge();
console.log('PASS: native edge scroll up/down, renderer displacement, physical hit testing, event identity, native-scroll yield/resume, drop cleanup and stale-workspace safety.');
