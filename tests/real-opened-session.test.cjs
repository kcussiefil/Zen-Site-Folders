const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const original=fs.readFileSync(path.join(__dirname,'../site-folders.uc.js'),'utf8');
const anchor="  if (document.readyState === 'complete') initialize();";
assert(original.includes(anchor));
const code=original.replace(anchor,"  window.timeProbe={noteNewTab,storedOpenedAt,restoreOpenedAt,reconcileOpenedAt,captureStartupGroupStates,restoreStartupGroupStates,watchWorkspaceInitialization,getRestoreState(){return {startupRestorePending,workspaceRestoreCompleted}},setRestoreBusy(x){sessionRestoreBusy=!!x}};\n"+anchor);
const sort='zsf-created-at-v1',time='zsf-opened-at-real-v1',now=Date.now();
function harness(saved=new Map()){
 const writes=[];
 const store={getCustomTabValue:(tab,key)=>saved.get(tab)?.get(key)||'',
 setCustomTabValue(tab,key,value){if(!saved.has(tab))saved.set(tab,new Map());saved.get(tab).set(key,value);writes.push({tab,key,value});}};
 const window={SessionStore:store,addEventListener(){}};
 vm.runInNewContext(code,{window,document:{readyState:'loading'},
 ChromeUtils:{importESModule:()=>({SessionStore:store})},console:{warn(){}},setTimeout,clearTimeout});
 return {p:window.timeProbe,window,saved,writes,get:(tab,key)=>store.getCustomTabValue(tab,key)};
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

// Zen's AfterWorkspacesSessionRestore may have happened before Sine loads.
// The already-settled workspace promise must clear the pending flag without
// falsely assigning an opening time to restored (historical) tabs.
async function lateInstallRegression() {
  const restoredTab={}, skipped={}, fresh={};
  const previous=String(Date.now()-180000);
  const saved=new Map([[restoredTab,new Map([[time,previous],[sort,previous]])]]);
  const h=harness(saved);
  const startup={willRestore:()=>true,state:{windows:[]}};
  h.p.captureStartupGroupStates(startup);
  assert.equal(h.p.getRestoreState().startupRestorePending,true);
  h.p.setRestoreBusy(true);
  h.p.noteNewTab(restoredTab);
  h.p.setRestoreBusy(false);
  h.p.noteNewTab(skipped);
  assert.equal(h.get(skipped,time),'','pending restore must not invent timestamps');
  assert.equal(h.get(restoredTab,time),previous,'restored tab must retain timestamp');

  const ready=Promise.resolve();
  // The real Zen native property is a Promise, not a one-shot event.
  h.p.getRestoreState();
  h.p.watchWorkspaceInitialization(); // no workspace object yet: safe
  // Harness deliberately doesn't invoke the DOM-dependent initialize().
  // Re-use its narrow promise watcher with a real settled Promise instead.
  const workspaceHandle={promiseInitialized:ready};
  // Promise watcher closes over window: expose it from the harness below.
  h.window.gZenWorkspaces=workspaceHandle;
  h.p.watchWorkspaceInitialization();
  await ready;
  await Promise.resolve();
  assert.equal(h.p.getRestoreState().startupRestorePending,false,
    'late-loaded mod must clear pending restore after settled Zen promise');
  assert.equal(h.p.getRestoreState().workspaceRestoreCompleted,true);
  h.p.noteNewTab(fresh);
  assert(Number(h.get(fresh,time)) > Date.now()-2000,
    'fresh tab must get its genuine time once restore has finished');
  assert.equal(h.get(restoredTab,time),previous,
    'clearing restore guard must not rewrite historical tabs');
  h.p.captureStartupGroupStates(startup);
  assert.equal(h.p.getRestoreState().startupRestorePending,false,
    'late SessionStartup callback must not re-enable restore guard');
  h.p.restoreStartupGroupStates();
  assert.equal(h.p.getRestoreState().startupRestorePending,false,
    'restore completion must be idempotent');
}

lateInstallRegression().then(
  ()=>console.log('PASS: new/duplicate/restore/lazy/late-load opening clocks, grouping independence, no polling'),
  err=>{console.error(err);process.exitCode=1;}
);
