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
assert(!/event\.dataTransfer\.setDragImage\s*\(/.test(code),
  'do not override the native/Zia drag picture with a second moving favicon');
assert(css.includes('gap: 8px !important') &&
  css.includes('margin-inline-start: 0 !important'),
  'two site favicons now have an 8px visible gap, no overlapping margin');
assert(css.includes(':root[data-zsf-manual-preview-active] :is(.tab-close-button, .tab-reset-button)') &&
  css.includes('visibility: hidden !important'),
  'native close/reset X is hidden only while manual preview is active');
assert(css.includes('#tabbrowser-tabs .tabbrowser-tab[data-zsf-manual-source]') &&
  css.includes('opacity: 0 !important'),
  'the moving tab image is hidden only while group portals are active');
assert(css.includes('brightness(0) invert(1)') &&
  css.includes('zsf-manual-merge-icon') &&
  css.includes('.zsf-favicon[src="chrome://browser/skin/zen-icons/folder.svg"]'),
  'native default folder icons turn white without tinting arbitrary favicons');

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
  const fresh=()=>harness();
  const h=fresh();
  assert.equal(h.count(),0);
  assert.equal(h.api.debug().stableMs,250,'need a genuine 250ms stationary centre dwell');
  assert.equal(h.api.debug().stationaryPx,3,'movement threshold rejects in-flight sort pauses');
  assert.equal(h.api.debug().holdMs,1200);
  h.fire('dragstart',h.a);
  const first=h.fire('dragover',h.b);
  assert(!first.prevented && !first.propagationStopped,
    'candidate observation NEVER blocks Zen/Zia native dragover');
  assert(h.api.debug().sorting && h.api.debug().rearming &&
    !h.root.hasAttribute('data-zsf-manual-preview-active'));
  await delay(110);
  assert(!h.root.children.some(x=>x.isConnected && x.id==='zsf-manual-merge-choice'),
    'short sorting pause does not show New Group');
  // Moving through another tab cancels the first dwell; native sorting owns it.
  const across=h.fire('dragover',h.c);
  assert(!across.prevented && h.api.debug().sorting);
  await delay(160);
  assert(!h.api.debug().portal && h.count()===0,
    'crossing between rows is ordinary sorting without a preview');
  const nativeDrop=h.fire('drop',h.c);
  assert(!nativeDrop.prevented && !nativeDrop.stopped &&
    h.api.debug().lastDrop==='native-sort',
    'normal one-slot/multi-slot release is never intercepted or snapped back');
  h.fire('dragend',h.a);h.api.destroy();

  // Leaving a centre before stable dwell must also preserve native drop.
  const early=fresh();
  early.fire('dragstart',early.a);
  early.fire('dragover',early.b);
  await delay(270);
  const earlyChoice=early.root.children.find(x=>x.isConnected &&
    x.id==='zsf-manual-merge-choice');
  assert(earlyChoice && early.api.debug().portal,
    '250ms stable dwell starts the editable horizontal fill');
  const earlyDrop=early.fire('drop',early.b);
  assert(!earlyDrop.prevented && !earlyDrop.stopped && early.count()===0,
    'even AFTER preview appears, dropping before 1.2s fill remains native sort');
  assert(!early.root.hasAttribute('data-zsf-manual-preview-active') &&
    !earlyChoice.isConnected && !early.a.hasAttribute('data-zsf-manual-source'),
    'unfinished preview, close X suppression and source hiding are cleaned');
  early.api.destroy();

  const h2=fresh();
  h2.fire('dragstart',h2.a);
  h2.fire('dragover',h2.b);
  await delay(280);
  const choice=h2.root.children.find(x=>x.isConnected && x.id==='zsf-manual-merge-choice');
  const pair=h2.root.children.find(x=>x.isConnected && x.id==='zsf-manual-pair');
  assert(choice && pair,'both original rows MUST be created');
  assert(choice.parentElement===h2.root && pair.parentElement===h2.root,
    'previews are root portals, never reparent native tabs');
  assert.equal(choice.style.getPropertyValue('top'),'100px');
  assert.equal(pair.style.getPropertyValue('top'),'136px');
  assert.equal(choice.style.getPropertyValue('--zsf-hold-ms'),'1200ms');
  assert.deepEqual(pair.children.map(x=>x.getAttribute('src')),
    ['chrome://test/A.svg','chrome://test/B.svg']);
  assert(h2.a.hasAttribute('data-zsf-manual-source') &&
    h2.root.hasAttribute('data-zsf-manual-preview-active'));
  assert.equal(choice.children.find(x=>x.className==='zsf-manual-merge-title').textContent,
    '新群組');
  assert(!h2.b.hasAttribute('data-zsf-manual-ready'));
  // Moving <3px preserves the hold, so unintentional jitter is harmless.
  const jitter=h2.fire('dragover',h2.b,{
    clientY:h2.b.getBoundingClientRect().top+18});
  assert(!jitter.prevented && h2.api.debug().portal &&
    choice.isConnected,'pointer jitter must not cancel running fill');
  // Zia may shift the target visually. Preview remains at the original row
  // while ordinary native dragover is never swallowed.
  h2.b.shiftY=84;h2.b.setAttribute('zia-shift','true');
  h2.b.style.setProperty('--zia-drag-y','48px');
  const shifted=h2.fire('dragover',h2.c,{clientY:154});
  assert(!shifted.prevented && pair.isConnected &&
    pair.style.getPropertyValue('top')==='136px');
  h2.scrollPort.scrollTop=20;
  h2.fire('scroll',h2.b);
  assert.equal(choice.style.getPropertyValue('top'),'80px');
  assert.equal(pair.style.getPropertyValue('top'),'116px');
  await delay(1230);
  assert(choice.hasAttribute('data-ready') && h2.b.hasAttribute('data-zsf-manual-ready'),
    'only completed 1.2s fill authorizes manual grouping');
  const accepted=h2.fire('drop',h2.b);
  assert(accepted.prevented && accepted.stopped && h2.count()===1);
  assert.deepEqual(h2.a.group.tabs.map(t=>t.label),['A','B']);
  assert.equal(h2.a.group.insertBefore,h2.a);
  h2.fire('dragend',h2.a);
  assert(!choice.isConnected && !pair.isConnected &&
    !h2.root.hasAttribute('data-zsf-manual-preview-active'));
  assert(h2.a.group===h2.b.group && h2.a.group.label==='新群組');
  assert(h2.a.group.hasAttribute('data-zsf-manual'));
  assert.equal(JSON.parse(h2.store['zsf-manual-groups-v1'])[h2.a.group.id].kind,'mixed');
  assert.equal(h2.a.group.querySelector('.tab-group-label-container')
    .querySelector(':scope > .zsf-favicon').getAttribute('src'),
    'chrome://browser/skin/zen-icons/folder.svg');
  h2.a.group.removeAttribute('data-zsf-manual');h2.api.restore();
  assert(h2.a.group.hasAttribute('data-zsf-manual'));
  assert.equal(h2.api.createFromTabs([h2.a,h2.c]),null);
  h2.api.destroy();

  const reverse=fresh();
  reverse.payload(reverse.c);
  reverse.fire('dragstart',reverse.c);
  reverse.fire('dragover',reverse.b);
  await delay(280);
  const label=reverse.root.children.find(x=>x.isConnected && x.id==='zsf-manual-merge-choice');
  const icons=reverse.root.children.find(x=>x.isConnected && x.id==='zsf-manual-pair');
  assert(label && icons && label.style.getPropertyValue('top')==='136px' &&
    icons.style.getPropertyValue('top')==='172px');
  assert.equal(icons.style.getPropertyValue('--zsf-pair-start-y'),'-36px');
  await delay(1230);
  assert(reverse.fire('drop',reverse.b).prevented && reverse.count()===1);
  assert.deepEqual(reverse.b.group.tabs.map(x=>x.label),['C','B'],
    'upward grouping remains dragged-first');
  reverse.fire('dragend',reverse.c);reverse.api.destroy();

  // The old adjacency test made icons disappear if native Zia re-sorted
  // beyond one original row. Both icons are required for ALL valid pairs.
  const distant=fresh();
  distant.fire('dragstart',distant.a);
  distant.fire('dragover',distant.d);
  await delay(280);
  const farPair=distant.root.children.find(x=>x.isConnected &&
    x.id==='zsf-manual-pair');
  assert(farPair && farPair.children.length===2 &&
    farPair.children.every(x=>x.getAttribute('src')),
    'a nonadjacent candidate must still show both website icons');
  distant.fire('dragend',distant.a);distant.api.destroy();

  // Preview cancellation releases the original source and lets Zen/Zia
  // finish the one-slot reorder. It must NOT cancel an unfinished drop.
  const move=fresh();
  move.fire('dragstart',move.a);
  move.fire('dragover',move.b);
  await delay(280);
  const preview=move.root.children.find(x=>x.isConnected &&
    x.id==='zsf-manual-merge-choice');
  const moveEvent=move.fire('dragover',move.b,{
    clientY:move.b.getBoundingClientRect().top+26});
  assert(!moveEvent.prevented && !move.api.debug().portal &&
    !preview.isConnected && !move.a.hasAttribute('data-zsf-manual-source') &&
    !move.root.hasAttribute('data-zsf-manual-preview-active'),
    'deliberate movement cancels grouping and restores native row immediately');
  const movedDrop=move.fire('drop',move.b);
  assert(!movedDrop.prevented && !movedDrop.stopped && move.count()===0,
    'cancelled candidate leaves drop available to native sort');
  move.api.destroy();

  // Zia can shift an event target one entire row while hovering. Previous
  // painted rects remain a fallback, without hijacking any dragover.
  const shift=fresh();
  shift.setHold('0.3');
  shift.fire('dragstart',shift.a);
  const oldRect=shift.b.getBoundingClientRect();
  shift.fire('dragover',shift.b,{clientY:oldRect.top+16});
  shift.b.shiftY-=36;
  shift.fire('dragover',shift.b,{clientY:oldRect.top+16});
  await delay(280);
  assert(shift.api.debug().portal,
    'stationary dwell remains valid across a Zia one-row shift');
  shift.fire('dragend',shift.a);shift.api.destroy();

  const custom=fresh();
  custom.setHold('0.3');assert.equal(custom.api.debug().holdMs,300);
  custom.setHold('2.8');assert.equal(custom.api.debug().holdMs,2500);
  custom.setHold('invalid');assert.equal(custom.api.debug().holdMs,1200);
  custom.api.destroy();

  const multi=fresh();
  multi.win.TabContextMenu.contextTab.multiselected=true;
  for(const fn of multi.menu.events.popupshowing||[])fn({target:multi.menu});
  const menuItem=multi.menu.children.find(x=>x.id==='zsf-manual-create-group');
  assert(menuItem && !menuItem.hidden);
  menuItem.click();assert.equal(multi.count(),1);
  multi.api.destroy();

  const off=harness({enabled:false});
  off.fire('dragstart',off.a);
  off.fire('dragover',off.b);
  await delay(270);
  assert(!off.fire('drop',off.b).prevented && off.count()===0);
  off.api.destroy();

  console.log('PASS: native sort-first drag/drop, 250ms stationary gate, no premature capture, two icons always shown, source cleanup, both native group directions');
})().catch(error=>{console.error(error);process.exitCode=1});
