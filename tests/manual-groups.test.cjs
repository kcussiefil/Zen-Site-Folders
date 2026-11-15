const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('site-folders-manual.uc.js','utf8');
const css = fs.readFileSync('userChrome.css','utf8');
new vm.Script(code);
assert(css.includes('#zsf-manual-merge-preview'), 'drag preview is a pointer-transparent overlay');
assert(css.includes('[data-zsf-manual]'), 'manual groups have scoped native icon styling');
assert(css.includes('opacity(0.3025)'), 'dark Zia effective asleep icon filter remains');
assert(css.includes('opacity(0.5625)'), 'light Zia effective asleep icon filter remains');
assert(!/\.pinTab\(|\.unpinTab\(/.test(code), 'manual groups must never pin or unpin');
assert(!/\.appendChild\(source\)|\.insertBefore\(source/.test(code),
  'preview must not reorder source DOM before drop');

class Node {
  constructor(localName = 'div') {
    this.localName = localName; this.isConnected = true;
    this.children = []; this.attrs = {}; this.events = {};
    this.style = {}; this.hidden = false; this.parentElement = null;
    this.className = ''; this.classList = {
      items: new Set(), add: name => this.classList.items.add(name),
      contains: name => this.classList.items.has(name)
    };
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  append(...nodes) { for(const node of nodes) this.appendChild(node); }
  insertBefore(child) { return this.appendChild(child); }
  get firstChild() { return this.children[0] || null; }
  remove() {
    this.isConnected = false;
    if(this.parentElement) this.parentElement.children =
      this.parentElement.children.filter(n=>n!==this);
  }
  setAttribute(k,v) { this.attrs[k]=String(v); }
  getAttribute(k) { return this.attrs[k]??null; }
  hasAttribute(k) { return Object.hasOwn(this.attrs,k); }
  removeAttribute(k) { delete this.attrs[k]; }
  matches(sel) {return this.localName==='tab-group' &&
    sel === 'tab-group:not([split-view-group])';}
  contains(node) { return node === this || this.children.some(x=>x.contains?.(node)); }
  querySelector(sel) {
    if(sel === '.tab-group-label-container') return this.children.find(x=>x.className==='tab-group-label-container')||null;
    if(sel === '.tab-group-label') return this.children.find(x=>x.className==='tab-group-label')||null;
    if(sel === '.zsf-manual-merge-title') return this.children.find(x=>x.className==='zsf-manual-merge-title')||null;
    if(sel === ':scope > .zsf-favicon') return this.children.find(x=>x.classList.items.has('zsf-favicon'))||null;
    return null;
  }
  getBoundingClientRect() { return {top:100,bottom:132,left:12,right:260,height:32,width:248}; }
  closest(sel) {
    if(sel === 'zen-workspace') return this.workspace || null;
    if(sel === '.tabbrowser-tab') return this.localName==='tab'?this:null;
    return null;
  }
  addEventListener(k,fn) { (this.events[k] ||= []).push(fn); }
  removeEventListener(k,fn) {this.events[k]=(this.events[k]||[]).filter(x=>x!==fn);}
  click() {for(const fn of this.events.command||[])fn({target:this});}
}

function harness({enabled=true}={}) {
  const ws=new Node('zen-workspace');ws.tabsContainer=ws;
  const root=new Node('window');
  const menu=new Node('menupopup');
  const tabContainer=new Node('tabs');
  const groups=[];
  const store={};
  let addCount=0;
  const SessionStore={
    getCustomWindowValue:(_win,key)=>store[key]||'',
    setCustomWindowValue:(_win,key,val)=>{store[key]=val}
  };
  const url={
    yt:'https://www.youtube.com/watch?v=1',
    reddit:'https://www.reddit.com/r/firefox',
  };
  function tab(name,site='yt'){
    const el=new Node('tab');
    el.label=name;el.workspace=ws;el.parentElement=ws;
    el.url=url[site];el.getAttribute=k=>k==='url'?el.url:null;
    el.linkedBrowser={currentURI:{spec:el.url}};
    return el;
  }
  const a=tab('A'),b=tab('B','reddit'),c=tab('C'),d=tab('D','reddit');
  const browser={
    tabs:[a,b,c,d],tabContainer,selectedTabs:[a,b], getIcon:tab=>'chrome://test/'+tab.label+'.svg',
    addTabGroup(tabs,opts) {
      addCount++;
      const group=new Node('tab-group');group.id='manual-'+addCount;
      group.label=opts.label;group.isZenFolder=false;
      group.tabs=[...tabs];for(const tab of tabs) tab.group=group;
      const label=new Node('hbox');label.className='tab-group-label-container';
      const title=new Node('label');title.className='tab-group-label';
      label.appendChild(title);group.appendChild(label);
      groups.push(group);return group;
    }
  };
  const win={
    SessionStore,gBrowser:browser,gZenWorkspaces:{activeWorkspaceElement:ws},
    TabContextMenu:{contextTab:a},
    addEventListener:root.addEventListener.bind(root),
    removeEventListener:root.removeEventListener.bind(root),
    __zsfMenuV037:{restoreDecorations(){}}
  };
  const doc={
    readyState:'complete',documentElement:root,
    createXULElement:name=>new Node(name),
    createElementNS:(_ns,name)=>new Node(name),
    getElementById:id=>id==='tabContextMenu'?menu:null,
    querySelectorAll:sel=>sel==='tab-group:not([split-view-group])'?groups:[],
    elementFromPoint:(_x,_y)=>doc.pointTarget
  };
  let dragOn=enabled;
  const services={prefs:{getBoolPref:(_key,fallback)=>dragOn},
    eTLD:{getBaseDomainFromHost:host=>host.split('.').slice(-2).join('.')}};
  vm.runInNewContext(code,{
    window:win, document:doc, Services:services, ChromeUtils:{}, console,URL,
    setTimeout,clearTimeout
  });
  const api=win.__zsfManualGroupsV099;
  assert(api?.createFromTabs && api?.restore);
  const fire=(type,target,extra={})=>{
    if (type==='dragover') doc.pointTarget=target;
    const ev={target,clientX:80,clientY:116,composedPath:()=>[target],
      dataTransfer:{mozGetDataAt:()=>a,dropEffect:'none'},
      preventDefault(){this.prevented=true;},
      stopImmediatePropagation(){this.stopped=true;},
      ...extra};
    for(const fn of root.events[type]||[])fn(ev);
    return ev;
  };
  return {a,b,c,d,win,doc,menu,groups,browser,api,fire,store,
    count:()=>addCount,allow:bool=>dragOn=bool};
}
const delay=ms=>new Promise(res=>setTimeout(res,ms));
(async()=>{
  const h=harness();
  assert.equal(h.count(),0,'no automatic creation at startup');
  h.fire('dragstart',h.a);
  h.fire('dragover',h.b,{clientY:101});
  await delay(190);
  assert.equal(h.count(),0,'edge hover cannot auto-create a group');
  h.fire('dragover',h.b);
  await delay(210);
  assert.equal(h.count(),0,'hover preview never changes tabs');
  assert(h.b.hasAttribute('data-zsf-manual-hover'),'target gets a temporary merge preview');
  const result=h.fire('drop',h.b);
  assert(result.prevented && result.stopped,'center drop intercepted before native reordering');
  assert.equal(h.count(),1);
  assert(h.a.group===h.b.group && !h.a.pinned && !h.b.pinned,'original tab objects remain unpinned');
  assert.equal(h.a.group.label,'新群組','mixed-site manual group uses neutral name');
  assert(h.a.group.hasAttribute('data-zsf-manual'),'manual group is never an owned site group');
  assert(!h.a.group.hasAttribute('data-zsf-site'));
  assert(!h.b.hasAttribute('data-zsf-manual-hover'),'preview cleanup');
  assert.equal(JSON.parse(h.store['zsf-manual-groups-v1'])[h.a.group.id].kind,'mixed');
  assert.equal(h.a.group.querySelector('.tab-group-label-container').querySelector(':scope > .zsf-favicon')
    .getAttribute('src'),'chrome://browser/skin/zen-icons/folder.svg');
  h.a.group.removeAttribute('data-zsf-manual');
  h.api.restore();
  assert(h.a.group.hasAttribute('data-zsf-manual'),'manual group decorations restore by stable id');
  assert.equal(h.api.createFromTabs([h.a,h.c]),null,'existing group members cannot be regrouped silently');
  h.api.destroy();

  const r=harness();
  const same=r.api.createFromTabs([r.c,r.a]);
  assert.equal(same.label,'YouTube','same-site groups receive site title');
  assert.equal(same.querySelector('.tab-group-label-container').querySelector(':scope > .zsf-favicon')
    .getAttribute('src'),'chrome://test/A.svg','site groups reuse original favicon');
  r.api.destroy();

  const m=harness();
  m.win.TabContextMenu.contextTab.multiselected=true;
  for(const fn of m.menu.events.popupshowing||[])fn({target:m.menu});
  const item=m.menu.children.find(n=>n.id==='zsf-manual-create-group');
  assert(item && !item.hidden,'native tab context menu exposes multi-selection grouping');
  item.click();
  assert.equal(m.count(),1,'multi-select right click uses the same native group API');
  m.api.destroy();

  const off=harness({enabled:false});
  off.fire('dragstart',off.a);
  off.fire('dragover',off.b);
  await delay(210);
  off.fire('drop',off.b);
  assert.equal(off.count(),0,'disabled drag pref leaves existing native drag unchanged');
  off.api.destroy();
  console.log('PASS: manual group drag center threshold, preview, native commit, metadata, restore, site icon, context menu and disabled guard');
})().catch(error=>{console.error(error);process.exitCode=1});
