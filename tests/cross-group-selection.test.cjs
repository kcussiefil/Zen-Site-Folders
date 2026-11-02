const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(process.env.ZSF_COLLAPSE_SOURCE||path.join(__dirname,'../site-folders-collapse.uc.js'),'utf8');
const listeners=new Map(),calls=[],writes=[];
function node(extra={}){const attrs=new Map(),css=new Map();return Object.assign({isConnected:true,pinned:false,
 hasAttribute:k=>attrs.has(k),getAttribute:k=>attrs.get(k)||null,setAttribute:(k,v)=>attrs.set(k,String(v)),removeAttribute:k=>attrs.delete(k),
 style:{setProperty(k,v){css.set(k,v);writes.push([k,v]);},removeProperty:k=>css.delete(k),getPropertyValue:k=>css.get(k)||''}},extra);}
const first=node({selected:true}),second=node({selected:false}),elsewhere=node({selected:false});
const group=node({tabs:[first,second],collapsed:true,isZenFolder:false,matches:()=>true,closest:()=>null,groupContainer:{hidden:false}});
first.group=second.group=group;
const proto={get activeGroups(){return this.hasAttribute('has-active')?[this]:[];},get childActiveGroups(){return [];},get activeTabs(){return this._activeTabs;},set activeTabs(v){this._activeTabs=v;for(const t of v)t.setAttribute('folder-active','true');}};
const win={addEventListener:(t,fn)=>listeners.set(t,fn),customElements:{get:()=>({prototype:proto})},gBrowser:{selectedTab:first,tabContainer:{querySelectorAll:s=>s==='zen-workspace'?[]:[group],_invalidateCachedVisibleTabs(){}}},
 gZenFolders:{animateExpand(){calls.push('expand');},animateCollapse(g){calls.push('collapse');g.activeTabs=g.tabs.filter(t=>t.selected);if(g.activeTabs.length)g.setAttribute('has-active','true');},styleCleanup(rows){for(const t of rows)for(const k of ['height','min-height','opacity'])t.style.removeProperty(k);}}};
vm.runInNewContext(source,{window:win,document:{readyState:'loading'},MutationObserver:class{observe(){}},queueMicrotask,console});
const api=win.__zsfCollapseV037;
(async()=>{
 api.start();assert.deepEqual(calls,['collapse']);writes.length=0;
 first.selected=false;elsewhere.selected=true;win.gBrowser.selectedTab=elsewhere;api.sync(group);
 assert(first.hasAttribute('folder-active'));assert(group.hasAttribute('has-active'));
 assert.equal(group.groupContainer.hidden,false);assert.deepEqual(writes,[]);assert.deepEqual(calls,['collapse']);
 api.sync(group);assert.deepEqual(calls,['collapse']);
 elsewhere.selected=false;second.selected=true;win.gBrowser.selectedTab=second;api.sync(group);
 assert(!first.hasAttribute('folder-active'));assert(second.hasAttribute('folder-active'));
 assert.equal(first.style.getPropertyValue('height'),'0px');assert.deepEqual(calls,['collapse','collapse']);
 group.tabs=[first];second.group=null;listeners.get('TabUngrouped')({target:group,detail:second});
 assert(!second.hasAttribute('folder-active'));assert.equal(second.style.getPropertyValue('height'),'');
 assert.equal(group.groupContainer.hidden,true);assert.deepEqual(calls,['collapse','collapse']);
 group.collapsed=false;api.sync(group);assert.equal(calls.at(-1),'expand');
 let finish;first.selected=true;group.collapsed=true;
 win.gZenFolders.animateCollapse=g=>{g.activeTabs=[first];g.setAttribute('has-active','true');return new Promise(r=>finish=r);};
 api.sync(group,true);first.selected=false;api.sync(group);
 let idle=false;const waiting=api.whenIdle(group).then(()=>idle=true);
 await Promise.resolve();await Promise.resolve();assert.equal(idle,false);
 finish();await waiting;assert.equal(idle,true);
 console.log('PASS: retained cross-group row, no reflow, same-group retirement, departure cleanup, manual expansion and pending native completion.');
})().catch(e=>{console.error(e);process.exitCode=1;});
