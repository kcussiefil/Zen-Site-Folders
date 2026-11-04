const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const original=fs.readFileSync(path.join(__dirname,'../site-folders.uc.js'),'utf8');
const anchor="  if (document.readyState === 'complete') initialize();";
assert(original.includes(anchor));
const code=original.replace(anchor,"  window.timeProbe={noteNewTab,storedOpenedAt,restoreOpenedAt,reconcileOpenedAt,setRestoreBusy(x){sessionRestoreBusy=!!x}};\n"+anchor);
const sort='zsf-created-at-v1',time='zsf-opened-at-real-v1',now=Date.now();
function harness(saved=new Map()){
 const writes=[];
 const store={getCustomTabValue:(tab,key)=>saved.get(tab)?.get(key)||'',
 setCustomTabValue(tab,key,value){if(!saved.has(tab))saved.set(tab,new Map());saved.get(tab).set(key,value);writes.push({tab,key,value});}};
 const window={SessionStore:store,addEventListener(){}};
 vm.runInNewContext(code,{window,document:{readyState:'loading'},
 ChromeUtils:{importESModule:()=>({SessionStore:store})},console:{warn(){}},setTimeout,clearTimeout});
 return {p:window.timeProbe,saved,writes,get:(tab,key)=>store.getCustomTabValue(tab,key)};
}
{
 const tab={},h=harness(new Map([[tab,new Map([[sort,String(now-86400000)]])]]));
 h.p.noteNewTab(tab);assert(Number(h.get(tab,time))>now-2000);
 assert.equal(h.get(tab,sort),String(now-86400000),'sort is independent');
}
{
 const first={},copy={},value=String(now-100000);
 const saved=new Map([[first,new Map([[sort,value],[time,value]])]]);
 const h=harness(saved);saved.set(copy,new Map(saved.get(first)));
 h.p.noteNewTab(copy);const fresh=h.get(copy,time);
 assert(Number(fresh)>now-2000);
 saved.set(copy,new Map(saved.get(first)));h.p.reconcileOpenedAt(copy);
 assert.equal(h.get(copy,time),fresh,'native duplicate late copy cannot reset time');
 assert.equal(h.get(first,time),value);
}
{
 const originalTab={},unknown={},value=String(now-150000);
 const saved=new Map([[originalTab,new Map([[time,value],[sort,value]])],
                       [unknown,new Map([[sort,value]])]]);
 const h=harness(saved);h.p.setRestoreBusy(true);h.p.noteNewTab(originalTab);
 h.p.noteNewTab(unknown);h.p.setRestoreBusy(false);
 assert.equal(h.get(originalTab,time),value);
 assert.equal(h.p.storedOpenedAt(unknown),null);
 assert.equal(unknown.__zsfReliableOpenedAt,undefined);
 assert.equal(h.writes.length,0,'restore must never rewrite historical records');
 const second=harness(saved);second.p.reconcileOpenedAt(originalTab);
 assert.equal(originalTab.__zsfReliableOpenedAt,Number(value));
 assert.equal(second.writes.length,0,'lazy restore reads existing SessionStore without writing');
}
{
 const tab={},h=harness();h.p.noteNewTab(tab);const previous=h.get(tab,time);
 h.p.reconcileOpenedAt(tab);assert.equal(h.get(tab,time),previous,'no reset on reload/restore');
}
assert(!code.includes('setInterval('),'opening-time tracking may not poll tabs');
console.log('PASS: new/duplicate/restore/lazy opening clocks, grouping independence, no polling');
