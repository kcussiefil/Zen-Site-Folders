/* Event-driven runtime recovery regression; no simulated tab rearrangement. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const core=fs.readFileSync(path.join(root,'site-folders.uc.js'),'utf8');
const drag=fs.readFileSync(path.join(root,'site-folders-background-drag.uc.js'),'utf8');
const start='  // BEGIN BACKGROUND_DRAG_RUNTIME_RECOVERY';
const end='  // END BACKGROUND_DRAG_RUNTIME_RECOVERY';
const a=core.indexOf(start),b=core.indexOf(end,a+start.length);
assert(a>0&&b>a,'actual Site Folders core must install runtime recovery');
const unit=core.slice(a,b);
assert(core.includes('    dragRecovery.init();'),'normal core initialization must register recovery');
const gitBlob=s=>{
 const buf=Buffer.from(s),header=Buffer.from('blob '+buf.length+'\0');
 return crypto.createHash('sha1').update(header).update(buf).digest('hex');
};
assert.equal(gitBlob(drag),'2bf96b968f918d47f66adf41f967b6c3d66d7f07',
  'known physically working v0.9.2/v0.9.3 native drag engine must remain byte-for-byte unchanged');
assert(!/setInterval|MutationObserver|preventDefault|stopPropagation|moveTabTo/.test(unit),
  'recovery cannot poll, intercept tab placement, or cancel native gestures');
function harness({pref=true,all=false,native=true,throwOnLoad=false}={}){
 let now=5000,loads=0,loadError=throwOnLoad;
 const listeners=new Map(),stripEvents=new Map();
 const node=(map,event,fn,remove)=>{
  if(!map.has(event))map.set(event,[]);
  if(remove)map.set(event,map.get(event).filter(f=>f!==fn));
  else map.get(event).push(fn);
 };
 const strip={
  tabDragAndDrop:native?{startTabDrag(){}}:null,
  contains:n=>n===tab,
  addEventListener(k,fn){node(stripEvents,k,fn,false);},
  removeEventListener(k,fn){node(stripEvents,k,fn,true);}
 };
 const tab={localName:'tab'},nonTab={localName:'toolbarbutton'};
 const window={
  gBrowser:{tabContainer:strip},
  __zsfBackgroundDragV090:{version:'0.9.2',debug:()=>({enabled:true})},
  addEventListener(k,fn){node(listeners,k,fn,false);},
  removeEventListener(k,fn){node(listeners,k,fn,true);}
 };
 const Services={
  prefs:{getBoolPref(k,d){
   if(k==='zen.sitefolders.background_drag.enabled')return pref;
   if(k==='sine.mods.disable-all')return all;
   return d;
  }},
  scriptloader:{loadSubScriptWithOptions(uri,options){
   loads++;
   assert.equal(uri,'chrome://sine/content/zen-site-folders/site-folders-background-drag.uc.js');
   assert.equal(options.target,window);
   assert.equal(options.ignoreCache,true);
   if(loadError)throw Error('simulated install failure');
   window.__zsfBackgroundDragV090={version:'0.9.2',debug:()=>({enabled:true})};
  }}
 };
 const console={warn(){}};
 const fakeDate={now(){return now;}};
 vm.runInNewContext("'use strict'; const TAG='[ZenSiteFolders]';\n"+
  unit+"\nwindow.__recovery=dragRecovery;",{Services,window,console,Date:fakeDate});
 window.__recovery.init();
 const fire=(type,opts)=>{
  const map=type==='TabSelect'?stripEvents:listeners;
  for(const fn of [...(map.get(type)||[])])fn({
   type,button:0,target:tab,composedPath(){return [tab,strip]},...opts
  });
 };
 return {window,strip,tab,nonTab,fire,
  erase(){delete window.__zsfBackgroundDragV090;},
  advance(n){now+=n;},
  status:()=>window.__recovery.debug(),
  loads:()=>loads,fail(v){loadError=v}};
}
{
 const h=harness();
 h.fire('TabSelect');
 assert.equal(h.loads(),0,'healthy module must never be reloaded');
 h.erase(); // User visits Zen settings and the guard vanishes.
 h.fire('TabSelect');
 assert.equal(h.loads(),1,'native tab selection must restore missing background drag');
 assert.equal(h.status().lastResult,'recovered');
 assert.equal(h.status().active,true);
 h.fire('focus');h.fire('TabSelect');
 assert.equal(h.loads(),1,'normal activity must not repeatedly wrap native accessors');
}
{
 const h=harness();
 h.erase();h.fire('focus');
 assert.equal(h.loads(),1,'browser focus must restore disappeared guard');
 h.erase();h.fire('TabSelect');h.fire('focus');
 assert.equal(h.loads(),1,'throttle cannot busy-loop when injection fails again');
 h.advance(1000);h.fire('focus');
 assert.equal(h.loads(),2,'after one second a new user event may retry');
 h.window.__recovery.stop();
 h.erase();h.advance(2000);h.fire('TabSelect');
 assert.equal(h.loads(),2,'window teardown must remove the health listeners');
}
{
 const h=harness({pref:false});
 h.erase();h.fire('TabSelect');h.fire('pointerdown');
 assert.equal(h.loads(),0,'hidden kill switch must stay authoritative');
 assert.equal(h.status().lastResult,'disabled');
}
{
 const h=harness({all:true});
 h.erase();h.fire('focus');
 assert.equal(h.loads(),0,'global Sine disable must stay authoritative');
}
{
 const h=harness({native:false});
 h.erase();h.fire('TabSelect');
 assert.equal(h.loads(),0,'never inject before native drag is ready');
 assert.equal(h.status().lastResult,'native-not-ready');
}
{
 const h=harness();
 h.erase();
 h.fire('pointerdown',{target:h.nonTab,composedPath(){return [h.nonTab]}});
 assert.equal(h.loads(),0,'unrelated pointer press must not trigger a reinstall');
 h.fire('pointerdown');
 assert.equal(h.loads(),1,'next real tab pointerdown must recover the missing guard');
}
{
 const h=harness({throwOnLoad:true});
 h.erase();h.fire('TabSelect');
 assert.equal(h.status().lastResult,'inject-failed');
 assert.match(h.status().lastError,/simulated install failure/);
 h.fail(false);h.advance(1000);h.fire('TabSelect');
 assert.equal(h.status().lastResult,'recovered');
 assert.equal(h.loads(),2,'retries must be recoverable after native hook readiness changes');
}
console.log('PASS: event-driven recovery, settings TabSelect, focus, pointerdown, throttle, disabled pref and no native drag modifications');
