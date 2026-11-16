const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code=fs.readFileSync('site-folders-manual.uc.js','utf8');
const css=fs.readFileSync('userChrome.css','utf8');
const theme=JSON.parse(fs.readFileSync('theme.json','utf8'));
new vm.Script(code);
assert(!theme.preferences && !fs.existsSync('preferences.json'),
  'Sine mod has no gear preferences or drag hold setting file');
for (const event of ['dragstart','dragover','dragend','drop']) {
  assert(!code.includes("bind(window, '"+event+"'"),
    'manual groups must not attach any '+event+' listener');
}
assert(!code.includes('manual_group_drag') && !code.includes('HOVER_MS') &&
  !code.includes('setDragImage') && !code.includes('previewSlots'),
  'old drag grouping controller, hold timer and preference are removed');
assert(!/zsf-manual-(merge-choice|pair|source|committing|preview-active)/.test(css),
  'obsolete manual drag preview CSS and native tab hiding are removed');
assert(code.includes("menuItem.setAttribute('label', '建立群組')") &&
  !code.includes('建立普通群組'), 'right-click option is named 建立群組');
assert(css.includes('.zsf-favicon[src="chrome://browser/skin/zen-icons/folder.svg"]') &&
  css.includes('brightness(0) invert(1)'),
  'existing manual folder white icon styling is preserved');
assert(css.includes('[data-zsf-manual]') &&
  css.includes('opacity(0.3025)') && css.includes('opacity(0.5625)'),
  'existing native folder style and asleep Zia filters remain');
class Node {
  constructor(localName = 'div') {
    this.localName = localName; this.isConnected = true;
    this.children = []; this.attrs = {}; this.events = {};
    const values = {};
    this.style = {
      setProperty:(k,v,p='')=>{values[k]={value:String(v),priority:p}},
      getPropertyValue:k=>values[k]?.value||'',
      getPropertyPriority:k=>values[k]?.priority||'',
      removeProperty:k=>{delete values[k]}
    };
    this.hidden = false; this.parentElement = null;
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
  getBoundingClientRect() { const top=100+(this.shiftY||0);return {top,bottom:top+32,left:12,right:260,height:32,width:248}; }
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
  const port=new Node('scrollbox');
  port.scrollTop=0;port.scrollHeight=1600;port.clientHeight=700;
  port.getBoundingClientRect=()=>({top:0,bottom:900});
  ws.scrollbox={scrollbox:port};
  const menu=new Node('menupopup');
  const tabContainer=new Node('tabs');
  tabContainer.tabDragAndDrop={_dontAnimateTabMove:false};
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
  [a,b,c,d].forEach((el,i)=>{el.shiftY=i*36;});
  const browser={
    tabs:[a,b,c,d],tabContainer,selectedTabs:[a,b], getIcon:tab=>'chrome://test/'+tab.label+'.svg',
    addTabGroup(tabs,opts) {
      addCount++;
      const group=new Node('tab-group');group.id='manual-'+addCount;
      group.label=opts.label;group.color=opts.color;group.isZenFolder=false;
      group.tabs=[...tabs];group.insertBefore=opts.insertBefore;
      for(const tab of tabs) tab.group=group;
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
  let dragOn=enabled,dragPayload=a,holdValue='1.2';
  const services={prefs:{getBoolPref:(_key,fallback)=>dragOn,
    getStringPref:(_key,fallback)=>holdValue||fallback},
    eTLD:{getBaseDomainFromHost:host=>host.split('.').slice(-2).join('.')}};
  vm.runInNewContext(code,{
    window:win, document:doc, Services:services, ChromeUtils:{}, console,URL,
    setTimeout,clearTimeout
  });
  const api=win.__zsfManualGroupsV099;
  assert(api?.createFromTabs && api?.restore);
  const fire=(type,target,extra={})=>{
    if (type==='dragover') doc.pointTarget=target;
    const ev={target,clientX:80,clientY:target.getBoundingClientRect().top+16,composedPath:()=>[target],
      dataTransfer:{mozGetDataAt:()=>dragPayload,dropEffect:'none'},
      preventDefault(){this.prevented=true;},
      stopPropagation(){this.propagationStopped=true;},
      stopImmediatePropagation(){this.stopped=true;},
      ...extra};
    for(const fn of root.events[type]||[])fn(ev);
    return ev;
  };
  return {a,b,c,d,win,doc,menu,groups,browser,api,fire,store,root,scrollPort:port,
    count:()=>addCount,allow:bool=>dragOn=bool,
    payload:tab=>{dragPayload=tab},setHold:value=>{holdValue=value}};
}
const delay=ms=>new Promise(res=>setTimeout(res,ms));
(async()=>{
  const h=harness();
  assert(h.api?.createFromTabs && h.api?.restore);
  assert(h.api.debug().mode==='context-menu-only' &&
    h.api.debug().dragging===false);
  assert(!['dragstart','dragover','dragend','drop'].some(
    event=>(h.root.events[event]||[]).length),
    'no native tab sorting/drag event is intercepted by manual group mod');
  h.fire('dragstart',h.a);
  h.fire('dragover',h.b);
  const ordinary=h.fire('drop',h.b);
  assert(!ordinary.prevented && !ordinary.stopped && h.count()===0,
    'ordinary drag remains unchanged and never makes a group');

  const menu=h.menu;
  const item=menu.children.find(n=>n.id==='zsf-manual-create-group');
  assert(item && item.getAttribute('label')==='建立群組',
    'context menu contains renamed item');
  for(const cb of menu.events.popupshowing||[])cb({target:menu});
  assert(item.hidden,'menu option is hidden without multiselection');
  h.win.TabContextMenu.contextTab.multiselected=true;
  for(const cb of menu.events.popupshowing||[])cb({target:menu});
  assert(!item.hidden,'menu option appears when multiple ordinary tabs selected');
  item.click();
  assert.equal(h.count(),1,'right click command creates native ordinary group');
  assert(h.a.group && h.a.group===h.b.group &&
    h.a.group.localName==='tab-group');
  assert.equal(h.a.group.label,'新群組');
  assert.equal(h.a.group.color,'gray');
  assert(!h.a.pinned && !h.b.pinned);
  assert.deepEqual(h.a.group.tabs.map(x=>x.label),['A','B']);
  assert.equal(JSON.parse(h.store['zsf-manual-groups-v1'])[h.a.group.id].kind,'mixed');
  assert.equal(h.a.group.querySelector('.tab-group-label-container')
    .querySelector(':scope > .zsf-favicon').getAttribute('src'),
    'chrome://browser/skin/zen-icons/folder.svg');
  h.a.group.removeAttribute('data-zsf-manual');
  h.api.restore();
  assert(h.a.group.hasAttribute('data-zsf-manual') &&
    h.a.group.color==='gray','existing manual group styling can be restored');
  assert.equal(h.api.createFromTabs([h.a,h.c]),null,
    'grouped or invalid members are rejected');
  h.api.destroy();
  assert(!item.isConnected,'destroy cleans only the installed right click item');

  const same=harness();
  const s=same.api.createFromTabs([same.a,same.c]);
  assert(s && s.label==='YouTube' && s.color==='gray',
    'same-site selected tabs create native group with site label');
  same.api.destroy();

  console.log('PASS: menu-only manual grouping, native drag untouched, renamed right-click item, no Sine gear, preserved restore/icon/style');
})().catch(error=>{console.error(error);process.exitCode=1});
