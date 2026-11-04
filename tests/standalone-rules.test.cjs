const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const original=fs.readFileSync(path.join(__dirname,'../site-folders.uc.js'),'utf8');
const anchor="  if (document.readyState === 'complete') initialize();";
assert(original.includes(anchor));
const script=original.replace(anchor,
  "  window.ruleTest={orderStandaloneTabs,arrangeStandaloneTabs,dissolveSingleMember};\n"+anchor);

function harness(){
  const root={localName:'tabs',children:[]};
  const stamps=new Map();
  const tab=(name,url,time=null)=>{
    const o={name,localName:'tab',isConnected:true,pinned:false,group:null,
      parentElement:root,linkedBrowser:{currentURI:{spec:url}},
      getAttribute:()=> 'space1',hasAttribute:()=>false,closest:()=>null,
      removeAttribute(){},style:{removeProperty(){}}};
    Object.defineProperty(o,'previousElementSibling',{get(){return root.children[root.children.indexOf(o)-1]||null;}});
    Object.defineProperty(o,'nextElementSibling',{get(){return root.children[root.children.indexOf(o)+1]||null;}});
    if(time!==null)stamps.set(o,String(time));
    return o;
  };
  const group=(name,site)=>({name,id:'zsf-'+name,localName:'tab-group',isConnected:true,
    isZenFolder:false,pinned:false,parentElement:root,tabs:[],
    hasAttribute:()=>false,
    getAttribute:key=>key==='data-zsf-site'?site:null,
    setAttribute(){},querySelectorAll(){return this.tabs;}});
  const browser={
    selectedTab:null,
    moveTabBefore(item,target){
      assert.equal(item.parentElement,root);
      root.children.splice(root.children.indexOf(item),1);
      root.children.splice(root.children.indexOf(target),0,item);
    },
    moveTabAfter(item,target){
      assert.equal(item.parentElement,root);
      root.children.splice(root.children.indexOf(item),1);
      root.children.splice(root.children.indexOf(target)+1,0,item);
    },
    ungroupTab(item){
      const owner=item.group;
      assert(owner);
      const at=root.children.indexOf(owner);
      assert(at>=0);
      root.children.splice(at,1);
      owner.isConnected=false;owner.tabs=[];
      root.children.unshift(item); // intentionally mimic an unsafe native insertion
      item.parentElement=root;item.group=null;
    }
  };
  const store={getCustomTabValue:(o,key)=>
    key==='zsf-opened-at-real-v1'?stamps.get(o)||'':''};
  const window={
    SessionStore:store,gBrowser:browser,
    gZenWorkspaces:{activeWorkspace:'space1',activeWorkspaceElement:{tabsContainer:root}},
    gZenFolders:{styleCleanup(){}},
    addEventListener(){}
  };
  vm.runInNewContext(script,{window,document:{readyState:'loading'},URL,Date,
    Services:{eTLD:{getBaseDomainFromHost:host=>host}},
    ChromeUtils:{importESModule(){throw Error('mock module unavailable')}},
    console,setTimeout,clearTimeout});
  return {root,tab,group,browser,rule:window.ruleTest};
}
(async ()=>{
  const one=harness();
  const unknownFirst=one.tab('unknown first','https://first.test/');
  const group=one.group('group','group.test');
  const old=one.tab('old','https://old.test/',Date.now()-300000);
  const unknownLast=one.tab('unknown last','https://last.test/');
  const recent=one.tab('recent','https://recent.test/',Date.now()-60000);
  one.root.children.push(unknownFirst,group,old,unknownLast,recent);
  const sorted=await one.rule.arrangeStandaloneTabs({includeManual:true});
  assert.equal(sorted.considered,4);
  assert.deepEqual(one.root.children.map(x=>x.name),
    ['group','recent','old','unknown first','unknown last'],
    'real timestamps are newest-first; missing times preserve original relative order');

  const two=harness();
  const parked=two.tab('parked','https://manual.test/');
  const closing=two.group('closing','closing.test');
  const existing=two.group('existing','existing.test');
  const tail=two.tab('tail','https://tail.test/',Date.now()-300000);
  const surviving=two.tab('surviving','https://surviving.test/',Date.now()-60000);
  closing.tabs=[surviving];surviving.group=closing;surviving.parentElement=closing;
  two.root.children.push(parked,closing,existing,tail);
  two.browser.selectedTab=parked;
  assert.equal(await two.rule.dissolveSingleMember(closing,surviving),true);
  assert.deepEqual(two.root.children.map(x=>x.name),
    ['parked','existing','surviving','tail'],
    'close of background group must not move manually parked tab above groups');
  assert.equal(surviving.group,null);

  const three=harness();
  const head=three.tab('head','https://head.test/');
  const owner=three.group('owner','owner.test');
  const following=three.group('following','following.test');
  const selected=three.tab('selected','https://selected.test/');
  owner.tabs=[selected];selected.group=owner;selected.parentElement=owner;
  three.root.children.push(head,owner,following);
  three.browser.selectedTab=selected;
  assert.equal(await three.rule.dissolveSingleMember(owner,selected),true);
  assert.deepEqual(three.root.children.map(x=>x.name),
    ['head','selected','following'],'selected member must retain former group slot');
  assert.equal(three.browser.selectedTab,selected);
  console.log('PASS: standalone A+B sort, background parking, selected and background auto dissolve');
})().catch(e=>{console.error(e);process.exitCode=1;});
