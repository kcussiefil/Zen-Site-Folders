const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(process.env.ZSF_SOURCE||path.join(__dirname,'../site-folders.uc.js'),'utf8');
function fixture({failWrite=false,sharedObject=false,inGroup=false,duplicate=true}={}){
 const values=new Map(),writes=[];
 const make=()=>({localName:'tab',isConnected:true,pinned:false,hasAttribute:()=>false,closest:()=>null,getAttribute:()=> 'ws',linkedBrowser:{currentURI:{spec:'https://example.test/same'}}});
 const first=make(),copy=sharedObject?first:make();values.set(first,'original-id');if(!sharedObject)values.set(copy,duplicate?'original-id':'another-id');
 const store={getCustomTabValue:(tab,key)=>values.get(tab)||'',setCustomTabValue:(tab,key,value)=>{writes.push({tab,key,value});if(!failWrite)values.set(tab,value);}};
 let serial=0;
 const win={SessionStore:store,addEventListener(){}};
 vm.runInNewContext(src.replace("  if (document.readyState === 'complete') initialize();","  window.probe={captureSnapshot};\n  if (document.readyState === 'complete') initialize();"),{window:win,document:{readyState:'loading'},ChromeUtils:{importESModule:()=>({SessionStore:store})},Services:{uuid:{generateUUID:()=>'{new-'+(++serial)+'}'}},console:{warn(){},error(){}},setTimeout,clearTimeout});
 const children=[first,copy];
 if(inGroup){const group={localName:'tab-group',id:'group',isConnected:true,label:'Test',color:'blue',hasAttribute:()=>false,getAttribute:()=>null,querySelectorAll:()=>children};first.group=copy.group=group;children.splice(0,2,group);group.querySelectorAll=()=>[first,copy];}
 return {first,copy,writes,values,capture:()=>win.probe.captureSnapshot({id:'ws',node:{tabsContainer:{children,querySelectorAll:()=>[first,copy]}}}),children};
}
for(const inGroup of [false,true]){
 const f=fixture({inGroup}),before=[...f.children],snapshot=f.capture();
 assert.equal(snapshot.tabs[0].id,'original-id');assert.notEqual(snapshot.tabs[1].id,'original-id');
 assert.equal(new Set(snapshot.tabs.map(t=>t.id)).size,2);assert.equal(f.values.get(f.first),'original-id');
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].tab,f.copy);assert.equal(f.writes[0].key,'zsf-tab-uid-v1');
 assert.deepEqual(f.children,before,'no DOM reorder or replacement');assert.equal(snapshot.tabs[0].url,snapshot.tabs[1].url,'duplicate URLs do not merge tab identity');
}
{const f=fixture({duplicate:false});f.capture();assert.equal(f.writes.length,0,'unique existing IDs remain untouched');}
{const f=fixture({failWrite:true});assert.throws(f.capture,/無法保存識別碼/,'unpersisted ID must still block sorting');}
{const f=fixture({sharedObject:true});assert.throws(f.capture,/同一分頁被重複收錄/);assert.equal(f.writes.length,0,'repeated reference must not rewrite the original tab ID');}
console.log('PASS: copied SessionStore IDs, same URLs, grouped/standalone capture, persistence failure and repeated-DOM-reference guard');
