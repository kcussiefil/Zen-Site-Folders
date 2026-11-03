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
const root=node();
vm.runInNewContext(source,{window:win,document:{readyState:'loading',documentElement:root},MutationObserver:class{observe(){}},queueMicrotask,console});
const api=win.__zsfCollapseV037;
const space={scrollbox:{}},port={scrollTop:80,getBoundingClientRect:()=>({top:0,bottom:500})};space.scrollbox.scrollbox=port;
group.closest=()=>space;elsewhere.closest=()=>space;elsewhere.localName='tab';
function base(){return 200-(first.style.getPropertyValue('height')==='0px'?38:0)-port.scrollTop;}
elsewhere.getBoundingClientRect=()=>({top:base()+((root.hasAttribute('data-zsf-grab-pending')||root.hasAttribute('zia-dragging-tab'))&&elsewhere.hasAttribute('data-zsf-grab-offset')?parseFloat(elsewhere.style.getPropertyValue('--zsf-native-grab-offset')):0)});
const emit=(t,e={})=>listeners.get(t)?.(e);
async function selectA(){first.selected=true;elsewhere.selected=false;win.gBrowser.selectedTab=first;api.sync(group,true);await api.whenIdle(group);}
function chooseB(){first.selected=false;elsewhere.selected=true;win.gBrowser.selectedTab=elsewhere;api.sync(group);}
function down(){emit('mousedown',{button:0,target:{closest:()=>elsewhere}});}
(async()=>{
 api.start();await api.whenIdle(group);
 const y=elsewhere.getBoundingClientRect().top;down();chooseB();
 assert(!first.hasAttribute('folder-active'));assert.equal(group.groupContainer.hidden,true,'A retires during mousedown, before mouseup or dragstart');
 assert.equal(port.scrollTop,42);assert.equal(elsewhere.getBoundingClientRect().top,y);emit('mouseup');assert.equal(elsewhere.getBoundingClientRect().top,y);
 await selectA();port.scrollTop=0;const top=elsewhere.getBoundingClientRect().top;down();chooseB();
 assert.equal(group.groupContainer.hidden,true);assert.equal(elsewhere.getBoundingClientRect().top,top,'only grabbed row is preserved while click/drag is determined');
 emit('mouseup');assert.equal(elsewhere.getBoundingClientRect().top,top-38,'top click may naturally reflow');
 await selectA();port.scrollTop=0;down();chooseB();emit('dragstart');root.setAttribute('zia-dragging-tab','true');await Promise.resolve();
 assert(!root.hasAttribute('data-zsf-grab-pending'));assert.equal(elsewhere.getBoundingClientRect().top,200,'native dragging keeps original grab position without a retained A row');
 root.removeAttribute('zia-dragging-tab');emit('dragend');assert(!elsewhere.hasAttribute('data-zsf-grab-offset'));
 await selectA();first.selected=false;second.selected=true;win.gBrowser.selectedTab=second;api.sync(group);
 assert(!first.hasAttribute('folder-active'));assert(second.hasAttribute('folder-active'));assert.equal(second.style.getPropertyValue('height'),'');
 // A scrolling backend can queue property writes. Compensation must be
 // committed before measuring a residual grab offset.
 second.selected=false;await selectA();let actualScroll=80,queued=null;
 Object.defineProperty(port,'scrollTop',{get:()=>actualScroll,set:v=>{queued=v;}});
 port.scrollTo=opts=>{assert.equal(opts.behavior,'instant');actualScroll=Math.max(0,opts.top);};
 const fixed=elsewhere.getBoundingClientRect().top;down();chooseB();
 assert.equal(actualScroll,42,'instant compensation is committed synchronously');
 assert.equal(queued,null,'do not queue an animated property write');
 assert.equal(elsewhere.getBoundingClientRect().top,fixed);assert(!elsewhere.hasAttribute('data-zsf-grab-offset'),'no artificial offset for a fully compensated click');
 emit('mouseup');assert.equal(elsewhere.getBoundingClientRect().top,fixed);
 console.log('PASS: immediate A retirement, normal scroll anchor, allowed top click reflow, native drag-only source offset, cleanup and same-group replacement; no spacer API used.');
})().catch(e=>{console.error(e);process.exitCode=1;});
