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
  assert(!h.root.children.some(n=>n.id==='zsf-manual-merge-choice'),
    'no group fill in the upstream guard zone');
  // The central 40% starts the 150ms stability check.
  h.fire('dragover',h.b);
  await delay(170);
  const choice=h.root.children.find(n=>n.id==='zsf-manual-merge-choice');
  const pair=h.root.children.find(n=>n.id==='zsf-manual-pair');
  assert(choice && pair && choice.parentElement===h.root && pair.parentElement===h.root,
    'downward A→B previews are root-fixed, never nested in a Zia-transformed tab');
  assert(h.a.hasAttribute('data-zsf-manual-source') &&
    h.root.hasAttribute('data-zsf-manual-preview-active'),
    'moving A and its native close X are hidden only while preview is active');
  assert(!h.a.children.includes(choice) && !h.b.children.includes(pair),
    'neither native row owns a draggable preview node');
  assert.equal(choice.style.getPropertyValue('top'),'100px','New Group occupies original upper A slot');
  assert.equal(pair.style.getPropertyValue('top'),'136px','overlapping icons occupy original lower B slot');
  assert.equal(choice.style.getPropertyValue('width'),'248px','root preview keeps original row width');
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
  assert.equal(choice.style.getPropertyValue('top'),'100px',
    'even when Zia translates B, the upper heading stays in A original slot');
  assert.equal(pair.style.getPropertyValue('top'),'136px',
    'even when Zia translates B, the lower pair never slides into the title');
  // When the sidebar scrolls, only the actual scroll offset adjusts both
  // root-level viewports, not the moving tab's temporary Zia transform.
  h.scrollPort.scrollTop=20;
  h.fire('scroll',h.b);
  assert.equal(choice.style.getPropertyValue('top'),'80px');
  assert.equal(pair.style.getPropertyValue('top'),'116px');
  const scrolled=h.fire('dragover',h.c,{clientY:132});
  assert(scrolled.prevented && h.api.debug().phase==='center',
    'the central hit area remains aligned with scrolled original slots');
  await delay(1230);
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
  assert(!h.a.hasAttribute('data-zsf-manual-source') &&
    !h.root.hasAttribute('data-zsf-manual-preview-active'),
    'dragged source and native close X are immediately restored after drop');
  assert(!h.b.hasAttribute('data-zsf-manual-pair'));
  assert(!choice.isConnected && !pair.isConnected,
    'root-level portals are removed on drop and never survive the drag');
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
  const label=reverse.root.children.find(n=>n.id==='zsf-manual-merge-choice');
  const icons=reverse.root.children.find(n=>n.id==='zsf-manual-pair');
  assert(label && icons && label.parentElement===reverse.root &&
    icons.parentElement===reverse.root,
    'upward C→B also renders both preview rows outside all Zia-transformed tabs');
  assert(reverse.c.hasAttribute('data-zsf-manual-source'),
    'upward dragging also hides only its active source row');
  assert.equal(label.style.getPropertyValue('top'),'136px','label occupies upper B slot');
  assert.equal(icons.style.getPropertyValue('top'),'172px','favicons occupy lower C slot');
  assert.equal(icons.style.getPropertyValue('--zsf-pair-start-y'),'-36px',
    'upward merged icons start in upper row and animate downward');
  await delay(1230);
  reverse.fire('drop',reverse.b);
  assert.equal(reverse.count(),1);
  assert.deepEqual(reverse.b.group.tabs.map(t=>t.label),['C','B'],
    'upward grouping is still dragged-first');
  assert.equal(reverse.b.group.insertBefore,reverse.b,'group title stays in B top slot');
  reverse.fire('dragend',reverse.c);
  assert(!label.isConnected && !icons.isConnected,'upward portals are cleaned after drop');
  assert(!reverse.c.hasAttribute('data-zsf-manual-source'),
    'upward dragged source restores after drop');
  reverse.api.destroy();

  const early=harness();
  early.fire('dragstart',early.a);
  early.fire('dragover',early.b);
  await delay(250);
  const earlyDrop=early.fire('drop',early.b);
  assert.equal(early.count(),0,'release before 1.2s fill never groups tabs');
  assert(!early.root.children.some(n=>n.isConnected &&
    (n.id==='zsf-manual-merge-choice'||n.id==='zsf-manual-pair')) &&
    !early.root.hasAttribute('data-zsf-manual-preview-active'),
    'premature release cleans independent previews and close-X suppression');
  assert(earlyDrop.prevented,'premature centre release must not reorder tabs');
  early.api.destroy();

  // A downward into B: once the pointer leaves an ACTIVE preview past
  // the 84% + 2px edge native sorting resumes; no new candidate is armed
  // merely by quickly crossing the next tab.
  const downSort=harness();
  downSort.fire('dragstart',downSort.a);
  downSort.fire('dragover',downSort.b);
  await delay(180);
  assert(downSort.a.hasAttribute('data-zsf-manual-source'));
  const bRect=downSort.b.getBoundingClientRect();
  const crossDown=downSort.fire('dragover',downSort.b,{
    clientY:bRect.top+bRect.height*.84+3});
  assert(!crossDown.prevented,'crossing active preview at 84% + 2px returns sorting to Zen/Zia');
  assert(downSort.api.debug().sorting && downSort.api.debug().phase==='sorting',
    'native sorting begins immediately after crossing far edge');
  assert(!downSort.browser.tabContainer.hasAttribute('data-zsf-manual-guard') &&
    !downSort.a.hasAttribute('data-zsf-manual-source') &&
    !downSort.root.children.some(x=>x.isConnected &&
      (x.id==='zsf-manual-merge-choice'||x.id==='zsf-manual-pair')),
    'crossing the far edge cleans preview, restores source and releases avoidance');
  const stillSort=downSort.fire('dragover',downSort.c);
  assert(!stillSort.prevented && downSort.api.debug().sorting &&
    !downSort.browser.tabContainer.hasAttribute('data-zsf-manual-guard'),
    'next row cannot immediately re-arm group hold while pointer is still moving');
  downSort.fire('drop',downSort.c);
  assert.equal(downSort.count(),0,'native sort does not silently group');
  downSort.fire('dragend',downSort.a);
  downSort.api.destroy();

  // Direct far-edge entry must yield sorting without first passing
  // through the narrow grouping band.
  const directSort=harness();
  directSort.fire('dragstart',directSort.a);
  const directRect=directSort.b.getBoundingClientRect();
  const direct=directSort.fire('dragover',directSort.b,{
    clientY:directRect.top+directRect.height*.85});
  assert(!direct.prevented && directSort.api.debug().sorting,
    'directly entering the far edge is a normal sort, not a new group candidate');
  assert(!directSort.fire('dragover',directSort.c).prevented,
    'direct sort remains active while crossing into C');
  directSort.fire('dragend',directSort.a);
  directSort.api.destroy();

  // C upward into B: crossing the upper 16% - 2px of a visible
  // preview restores native sorting with the same cleanup.
  const upSort=harness();
  upSort.payload(upSort.c);
  upSort.fire('dragstart',upSort.c);
  upSort.fire('dragover',upSort.b);
  await delay(180);
  const upperRect=upSort.b.getBoundingClientRect();
  const crossUp=upSort.fire('dragover',upSort.b,{
    clientY:upperRect.top+upperRect.height*.16-3});
  assert(!crossUp.prevented && upSort.api.debug().sorting,
    'upward crossing active preview at 16% - 2px yields native sorting');
  assert(!upSort.c.hasAttribute('data-zsf-manual-source'));
  assert(!upSort.fire('dragover',upSort.a).prevented &&
    upSort.api.debug().phase==='sorting',
    'moving into A cannot instantly re-enter a group before 150ms stability');
  upSort.fire('dragend',upSort.c);
  upSort.api.destroy();

  // Regression for v1.0.5: a single overstep permanently disabled
  // grouping. A deliberate 150ms stationary re-hover MUST reactivate a
  // preview without releasing the mouse or starting another drag.
  const recover=harness();
  recover.setHold('0.3');
  recover.fire('dragstart',recover.a);
  const rb=recover.b.getBoundingClientRect();
  recover.fire('dragover',recover.b,{clientY:rb.top+rb.height*.85});
  assert(recover.api.debug().sorting,'the initial far edge gives native sort priority');
  const back=recover.fire('dragover',recover.b);
  assert(!back.prevented && recover.api.debug().rearming &&
    !recover.root.hasAttribute('data-zsf-manual-preview-active'),
    're-entering centre waits for stability but does not block native sorting');
  await delay(175);
  assert(!recover.api.debug().sorting && recover.api.debug().portal &&
    recover.root.hasAttribute('data-zsf-manual-preview-active'),
    'stable re-hover within same drag restores the real preview and hides X');
  const recoveredChoice=recover.root.children.find(n=>n.isConnected &&
    n.id==='zsf-manual-merge-choice');
  assert(recoveredChoice?.style.getPropertyValue('--zsf-hold-ms')==='300ms',
    'rearmed preview uses the same Sine-configurable hold duration');
  await delay(350);
  const recoveredDrop=recover.fire('drop',recover.b);
  assert(recoveredDrop.prevented && recover.count()===1,
    'after re-arming, the SAME drag successfully creates a normal native group');
  assert.deepEqual(recover.a.group.tabs.map(t=>t.label),['A','B'],
    'successful group ordering stays dragged-source-first after rearm');
  assert(!recover.root.hasAttribute('data-zsf-manual-preview-active'),
    'preview X suppression clears after success');
  recover.fire('dragend',recover.a);recover.api.destroy();

  const shiftedRearm=harness();
  shiftedRearm.setHold('0.3');
  shiftedRearm.fire('dragstart',shiftedRearm.a);
  const oldB=shiftedRearm.b.getBoundingClientRect();
  shiftedRearm.fire('dragover',shiftedRearm.b,{
    clientY:oldB.top+oldB.height*.85});
  assert(shiftedRearm.api.debug().sorting);
  // Simulate Zia moving B visually one row before our next window-capture
  // listener receives a new dragover at B's formerly painted centre.
  shiftedRearm.b.shiftY-=36;
  shiftedRearm.fire('dragover',shiftedRearm.b,{
    clientY:oldB.top+oldB.height*.5});
  assert(shiftedRearm.api.debug().rearming &&
    shiftedRearm.api.debug().rearmDiagnostic?.previousCentre,
    'previous painted target centre remains valid across a one-row Zia shift');
  await delay(175);
  assert(shiftedRearm.api.debug().portal && !shiftedRearm.api.debug().sorting,
    'stationary re-hover starts the hold even though Zia shifted B');
  shiftedRearm.fire('dragend',shiftedRearm.a);
  shiftedRearm.api.destroy();

  const moving=harness();
  moving.fire('dragstart',moving.a);
  const mb=moving.b.getBoundingClientRect();
  moving.fire('dragover',moving.b,{clientY:mb.top+mb.height*.85});
  moving.fire('dragover',moving.b);
  await delay(60);
  moving.fire('dragover',moving.c);
  await delay(60);
  moving.fire('dragover',moving.d);
  await delay(60);
  moving.fire('dragover',moving.d,{clientY:1100});
  await delay(175);
  assert(moving.api.debug().sorting && !moving.api.debug().portal &&
    !moving.api.debug().rearming,
    'passing through C and D without a stationary 150ms hover leaves native sorting responsive');
  moving.fire('dragend',moving.a);moving.api.destroy();

  const jitter=harness();
  jitter.fire('dragstart',jitter.a);
  jitter.fire('dragover',jitter.b);
  await delay(180);
  const jr=jitter.b.getBoundingClientRect();
  const wobble=jitter.fire('dragover',jitter.b,{
    clientY:jr.top+jr.height*.77});
  assert(wobble.prevented && jitter.api.debug().portal &&
    !jitter.api.debug().sorting,
    'small pointer drift beyond 70% does not cancel a running hold');
  jitter.fire('dragend',jitter.a);
  assert(!jitter.root.hasAttribute('data-zsf-manual-preview-active'),
    'cancellation immediately restores native X buttons');
  jitter.api.destroy();

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
  console.log('PASS: 150ms stationary group rearm after native sorting, 8px separated favicons, preview-only native close X suppression, drag cleanup and grouping');
})().catch(error=>{console.error(error);process.exitCode=1});
