const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const window={addEventListener(){},removeEventListener(){},gZenWorkspaces:{activeWorkspace:'test'}};
let nativeSlot=null;
const document={documentElement:{hasAttribute:()=>true},querySelector:()=>nativeSlot};
const src=fs.readFileSync(process.env.ZSF_TOP_DROP_SOURCE || path.join(__dirname,'../site-folders-top-drop.uc.js'),'utf8');
vm.runInNewContext(src.replace('  window.__zsfTopDrop = {','  window.probe={arm,reset,headerTarget};window.__zsfTopDrop = {'),{window,document,setTimeout,clearTimeout});
function fixture(){
 let moves=0;const container={children:[],insertBefore(t,b){if(t.group)t.group.tabs=t.group.tabs.filter(x=>x!==t);t.group=group;group.tabs=group.tabs.filter(x=>x!==t);group.tabs.splice(b?group.tabs.indexOf(b):group.tabs.length,0,t);moves++;return t;},appendChild(t){return this.insertBefore(t,null);}};
 const group={isConnected:true,pinned:false,isZenFolder:false,collapsed:true,matches:()=>true,hasAttribute:()=>false,removeAttribute(){},style:{removeProperty(){}},tabs:[],querySelector:()=>container,children:[],appendChild(t){return container.appendChild(t);}};
 const tab=name=>({name,localName:'tab',isConnected:true,pinned:false,multiselected:false,hasAttribute:()=>false,get parentElement(){return this.group?container:null;},get nextElementSibling(){return this.group?.tabs[this.group.tabs.indexOf(this)+1]||null;}});
 const first=tab('first'),last=tab('last'),incoming=tab('incoming');first.group=last.group=group;group.tabs=[first,last];container.children=[first,last];
 window.gBrowser={moveTabBefore(t,b){if(t.group!==group)group.appendChild(t);return container.insertBefore(t,b);},moveTabAfter(){throw Error('late end move');},moveTabToExistingGroup(){throw Error('late end join');},moveTabToEnd(){throw Error('late end');},ungroupTab(){throw Error('native queued ungroup must not remove the committed first row');}};
 return {group,incoming,first,last,moves:()=>moves};
}
for(const method of ['moveTabBefore','moveTabAfter','moveTabToExistingGroup','moveTabToEnd','ungroupTab']){
 const f=fixture(),native=window.gBrowser.moveTabBefore,c=window.probe.arm(f.group,f.incoming);assert(c);
 window.gBrowser[method](f.incoming,f.group);assert.equal(f.moves(),0,'preview cannot mutate order');
 c.accepted=true;c.land();window.gBrowser[method](f.incoming,f.group);window.gBrowser.ungroupTab(f.incoming);f.group.appendChild(f.incoming);
 assert.equal(f.moves(),1);assert.equal(f.group.tabs[0],f.incoming);assert.equal(f.group.tabs[1],f.first);
 window.probe.reset();assert.equal(window.gBrowser.moveTabBefore,native);
}
{
 const f=fixture(),c=window.probe.arm(f.group,f.incoming);c.accepted=true;window.gZenWorkspaces.activeWorkspace='other';c.land();assert.equal(f.moves(),0);window.probe.reset();window.gZenWorkspaces.activeWorkspace='test';
}
{
 const f=fixture();assert.equal(window.probe.arm(f.group,f.first),null);f.incoming.pinned=true;assert.equal(window.probe.arm(f.group,f.incoming),null);
}
console.log('PASS: header join first in one insertion; no preview mutation or later fallback reorder; restore, stale workspace, same-group and pinned guards.');

{
 const f=fixture(),header={getBoundingClientRect:()=>({left:0,right:260,top:100,bottom:134})};
 f.group.querySelector=q=>q.includes('label-container')?header:null;f.group.getBoundingClientRect=header.getBoundingClientRect;
 f.group.hasAttribute=k=>k==='zia-drop-slot';
 const target={closest:q=>q.includes('label-container')?null:f.group};
 nativeSlot=f.group;
 assert.equal(window.probe.headerTarget({target,clientX:130,clientY:117}),f.group,'native preview owner resolves the closed group');
 assert.equal(window.probe.headerTarget({target:{closest:()=>null},clientX:130,clientY:180}),f.group,'moving tab under pointer cannot discard the native folder preview');
 nativeSlot=null;
 assert.equal(window.probe.headerTarget({target,clientX:130,clientY:117}),null,'no native folder preview means no forced group entry');
}
{
 const f=fixture();f.group.getBoundingClientRect=()=>({left:0,right:260,top:100,bottom:300});
 f.group.querySelector=()=>null;
 f.group.collapsed=false;
 assert.equal(window.probe.arm(f.group,f.incoming),null,'expanded entry cannot install a first-position guard');
 assert.equal(window.probe.headerTarget({target:{closest:q=>q.includes('label-container')?null:f.group},clientX:130,clientY:200}),null,'expanded group body keeps native free placement');
}
console.log('PASS: closed-group entry only; expanded group and same-group native placement unchanged.');
