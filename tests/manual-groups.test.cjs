const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('site-folders-manual.uc.js','utf8');
const css = fs.readFileSync('userChrome.css','utf8');
new vm.Script(code);
assert(css.includes('#zsf-manual-merge-choice'), 'Yab-style integrated New Group row is present');
assert(css.includes('zsf-manual-horizontal-fill'), 'horizontal left-to-right progress is present');
assert(css.includes('visibility: hidden !important'), 'original tab contents are replaced, not duplicated');
assert(!css.includes('#zsf-manual-merge-progress'), 'circular ring removed');
assert(!css.includes('#zsf-manual-merge-preview'), 'old translucent row card removed');
assert(!css.includes('zsf-manual-ring-fill'), 'ring animation removed');
assert(!css.includes('data-zsf-color-custom'), 'no color-accent styling remains');
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
  return {a,b,c,d,win,doc,menu,groups,browser,api,fire,store,
    count:()=>addCount,allow:bool=>dragOn=bool,
    payload:tab=>{dragPayload=tab},setHold:value=>{holdValue=value}};
}
const delay=ms=>new Promise(res=>setTimeout(res,ms));
(async()=>{
  const h=harness();
  assert.equal(h.count(),0,'no automatic creation at startup');
  assert.equal(h.api.debug().stableMs,150);
  assert.equal(h.api.debug().holdMs,1200,'Sine number input defaults to 1.2 seconds');
  h.fire('dragstart',h.a);
  // Entering the upstream edge must NOT make B avoid A yet.
  const approach=h.fire('dragover',h.b,{clientY:h.b.getBoundingClientRect().top+3});
  assert(approach.prevented && h.browser.tabContainer.hasAttribute('data-zsf-manual-guard'),
    'approach edge holds the source slot and blocks early native avoidance');
  await delay(175);
  assert(!h.a.children.some(n=>n.id==='zsf-manual-merge-choice'),
    'no group fill in the upstream guard zone');
  // The central 40% starts the 150ms stability check.
  h.fire('dragover',h.b);
  await delay(170);
  const choice=h.a.children.find(n=>n.id==='zsf-manual-merge-choice');
  const pair=h.b.children.find(n=>n.id==='zsf-manual-pair');
  assert(choice && pair,'downward A→B uses upper A row for title and lower B row for icon pair');
  assert.equal(choice.children.find(n=>n.className==='zsf-manual-merge-title')?.textContent,
    '新群組');
  assert.deepEqual(pair.children.map(n=>n.getAttribute('src')),
    ['chrome://test/A.svg','chrome://test/B.svg'],
    'only dragged/target favicons overlap, in dragged-first order');
  assert(choice.hasAttribute('data-running'),'horizontal fill started after stability check');
  assert.equal(choice.style.getPropertyValue('--zsf-hold-ms'),'1200ms');
  assert(!h.b.hasAttribute('data-zsf-manual-ready'),'not ready before 1.2s');
  // A shifted Zia row must NOT change which original centre band is held.
  const originalY=152;
  h.b.shiftY=84; h.b.setAttribute('zia-shift','true');
  h.b.style.setProperty('--zia-drag-y','48px');
  const moved=h.fire('dragover',h.c,{clientY:originalY});
  assert(moved.prevented && h.api.debug().phase==='center',
    'fixed original B slot remains locked despite Zia visual shift');
  await delay(1110);
  assert(choice.hasAttribute('data-ready') && h.b.hasAttribute('data-zsf-manual-ready'),
    'after 1.2 seconds of fill A→B is ready');
  assert.equal(h.count(),0,'preview does not mutate tab identities or native DOM');
  const result=h.fire('drop',h.b);
  assert(result.prevented && result.stopped,'ready drop intercepted before native reorder');
  assert.equal(h.count(),1);
  assert.deepEqual(h.a.group.tabs.map(t=>t.label),['A','B'],
    'dragged A remains before hovered B');
  assert.equal(h.a.group.insertBefore,h.a,'group title remains in original top A slot');
  assert.equal(h.browser.tabContainer.tabDragAndDrop._dontAnimateTabMove,false);
  h.fire('dragend',h.a);
  assert(!h.browser.tabContainer.hasAttribute('data-zsf-manual-guard'),
    'native sorting is unlocked after commit');
  assert(h.a.group===h.b.group && !h.a.pinned && !h.b.pinned);
  assert.equal(h.a.group.label,'新群組');
  assert(h.a.group.hasAttribute('data-zsf-manual'));
  assert(!h.a.hasAttribute('data-zsf-manual-choice'));
  assert(!h.b.hasAttribute('data-zsf-manual-pair'));
  assert.equal(JSON.parse(h.store['zsf-manual-groups-v1'])[h.a.group.id].kind,'mixed');
  assert.equal(h.a.group.color,'gray');
  assert.equal(JSON.parse(h.store['zsf-manual-groups-v1'])[h.a.group.id].color,undefined);
  assert.equal(h.a.group.querySelector('.tab-group-label-container').querySelector(':scope > .zsf-favicon')
    .getAttribute('src'),'chrome://browser/skin/zen-icons/folder.svg');
  h.a.group.removeAttribute('data-zsf-manual');h.api.restore();
  assert(h.a.group.hasAttribute('data-zsf-manual'));
  assert.equal(h.api.createFromTabs([h.a,h.c]),null);
  assert(!('setColor' in h.api));
  h.api.destroy();

  const r=harness();
  const same=r.api.createFromTabs([r.c,r.a]);
  assert.equal(same.label,'YouTube','same-site groups receive site title');
  assert.equal(same.querySelector('.tab-group-label-container').querySelector(':scope > .zsf-favicon')
    .getAttribute('src'),'chrome://test/A.svg','site groups reuse original favicon');
  r.api.destroy();

  const reverse=harness();
  reverse.payload(reverse.c); // B is above C; drag C upward onto B.
  reverse.fire('dragstart',reverse.c);
  reverse.fire('dragover',reverse.b);
  await delay(175);
  const label=reverse.b.children.find(n=>n.id==='zsf-manual-merge-choice');
  const icons=reverse.c.children.find(n=>n.id==='zsf-manual-pair');
  assert(label && icons,'upward C→B keeps label on B and favicons on original C row');
  assert.equal(icons.style.getPropertyValue('--zsf-pair-start-y'),'-36px',
    'upward merged icons start in upper row and animate downward');
  await delay(1120);
  reverse.fire('drop',reverse.b);
  assert.equal(reverse.count(),1);
  assert.deepEqual(reverse.b.group.tabs.map(t=>t.label),['C','B'],
    'upward grouping is still dragged-first');
  assert.equal(reverse.b.group.insertBefore,reverse.b,'group title stays in B top slot');
  reverse.fire('dragend',reverse.c);reverse.api.destroy();

  const early=harness();
  early.fire('dragstart',early.a);
  early.fire('dragover',early.b);
  await delay(250);
  const earlyDrop=early.fire('drop',early.b);
  assert.equal(early.count(),0,'release before 1.2s fill never groups tabs');
  assert(earlyDrop.prevented,'premature centre release must not reorder tabs');
  early.api.destroy();

  const custom=harness();
  custom.setHold('0.3');
  assert.equal(custom.api.debug().holdMs,300,'Sine user input can shorten hold to 0.3s');
  custom.setHold('2.8');
  assert.equal(custom.api.debug().holdMs,2500,'out-of-range hold clamps safely at 2.5s');
  custom.setHold('invalid');
  assert.equal(custom.api.debug().holdMs,1200,'invalid input safely reverts to 1.2s');
  custom.api.destroy();

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
  await delay(180);
  off.fire('drop',off.b);
  assert.equal(off.count(),0,'disabled drag pref leaves existing native drag unchanged');
  off.api.destroy();
  console.log('PASS: 150ms stability, configurable 1.2s fill, dual-direction favicons, centre-only grouping, dragged-first order and native unlock');
})().catch(error=>{console.error(error);process.exitCode=1});
