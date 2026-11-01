const selectedCase = arguments[0];
const finish = arguments[arguments.length - 1];
(async () => {
  const results = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const core = window.__zenSiteFoldersV037;
  const drag = window.__zsfDragV037;
  const motion = window.__zsfCollapseV037;
  const root = () => gZenWorkspaces.activeWorkspaceElement.tabsContainer;
  const order = group => [...group.querySelectorAll('tab')].filter(tab => tab.group === group);
  const same = (a, b) => a.length === b.length && a.every((tab, i) => tab === b[i]);
  const names = list => list.map(tab => tab.zsfTestName || tab.id);
  let serial = 0;
  async function fixture(caseName = '') {
    const id = ++serial;
    const make = name => {
      const tab = gBrowser.addTab('about:blank#zsf-' + id + name, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
      });
      tab.zsfTestName = name;
      return tab;
    };
    const prefix = make('prefix'), tabs = ['A', 'B', 'C', 'D'].map(make), suffix = make('suffix');
    // Only the scroll stability test needs a guaranteed overflowing real
    // arrowscrollbox even when run alone with --case.
    if (caseName.includes('scroll offset') || caseName.includes('drag edge')) {
      for (let i = 0; i < 34; i++) make('overflow-' + i);
    }
    const group = gBrowser.addTabGroup(tabs, { id: 'zsf-native-test-' + id,
      label: 'GitHub', insertBefore: tabs[0], showCreateUI: false });
    group.setAttribute('data-zsf-site', 'github.com');
    gBrowser.selectedTab = prefix;
    await delay(500); // allow the fixture's new-tab animations and navigation to finish
    group.collapsed = false;
    group.scrollIntoView({ block: 'nearest' });
    if (motion.whenIdle) await motion.whenIdle(group);
    assert(same(order(group), tabs), 'fixture must begin A B C D');
    return { group, tabs, prefix, suffix, browsers: tabs.map(tab => tab.linkedBrowser) };
  }
  async function guarded(h, fn) {
    const methods = ['pinTab', 'unpinTab', 'removeTab', 'removeTabs', 'addTab', 'addTrustedTab'];
    const saved = new Map(methods.map(key => [key, gBrowser[key]]));
    for (const key of methods) gBrowser[key] = () => { throw new Error('Forbidden tab operation: ' + key); };
    try {
      await fn();
      h.tabs.forEach((tab, i) => assert(tab.isConnected && !tab.pinned && tab.linkedBrowser === h.browsers[i],
        'same tab and linked browser must survive without pinning'));
    } finally { for (const [key, value] of saved) gBrowser[key] = value; }
  }
  async function test(name, fn) {
    if (selectedCase && !name.includes(selectedCase)) return;
    try {
      const h = await fixture(name);
      await guarded(h, () => fn(h));
      results.push({ name, status: 'PASS' });
    } catch (error) { results.push({ name, status: 'FAIL', error: String(error.message || error) + '\n' + (error.stack || '') }); }
  }
  async function idle(group) {
    if (motion.whenIdle) await motion.whenIdle(group);
    if (drag.nativeIdle) assert(await drag.nativeIdle(group), 'native animations must finish');
    else await delay(700); // baseline v0.3.7 has no completion API
  }
  const click = group => group.labelElement.dispatchEvent(new MouseEvent('click', {
    bubbles: true, composed: true, button: 0
  }));
  function snapshot(h) {
    const workspaceId = gZenWorkspaces.activeWorkspace;
    const tabs = h.tabs.map((tab, i) => {
      const id = 'native-' + serial + '-' + i;
      SessionStore.setCustomTabValue(tab, 'zsf-tab-uid-v1', id);
      return { id, group: null, pinned: false, url: tab.linkedBrowser.currentURI.spec };
    });
    const value = { version: 4, workspaceId, capturedAt: Date.now(),
      tabs, elements: tabs.map(tab => ({ type: 'tab', id: tab.id })), createdFolders: [h.group.id] };
    SessionStore.setCustomWindowValue(window, 'zsf-before-sort-v1', JSON.stringify({ [workspaceId]: value }));
    return { workspaceId, value };
  }
  // Real custom element click -> native setter -> native event -> native animations -> computed layout.
  await test('native collapse/expand, rapid reversal and selected row', async h => {
    const expanded = h.group.groupContainer.getBoundingClientRect().height;
    assert(expanded > 60, 'expanded group must have real row geometry');
    click(h.group); await idle(h.group);
    assert(h.group.collapsed, 'native click must set collapsed');
    assert(h.group.groupContainer.getBoundingClientRect().height <= 1, 'inactive collapsed group must actually occupy zero height');
    click(h.group); await idle(h.group);
    assert(h.group.groupContainer.getBoundingClientRect().height > 60, 'expand must restore real rows');
    click(h.group); await delay(30); click(h.group); await delay(20); click(h.group);
    await idle(h.group);
    assert(h.group.collapsed && h.group.groupContainer.getBoundingClientRect().height <= 1, 'rapid close/open/close must settle closed');
    gBrowser.selectedTab = h.tabs[1]; await idle(h.group);
    assert(h.tabs[1].getBoundingClientRect().height > 10, 'selected tab in collapsed folder must be visible');
    assert(h.tabs.filter(tab => tab !== h.tabs[1]).every(tab => tab.getBoundingClientRect().height <= 1), 'other rows stay collapsed');
    gBrowser.selectedTab = h.tabs[3]; await idle(h.group);
    assert(h.tabs[3].getBoundingClientRect().height > 10 && h.tabs[1].getBoundingClientRect().height <= 1,
      'selection transfer must reveal only the new row: ' + JSON.stringify(h.tabs.map(t => ({
        name: t.zsfTestName, selected: t.selected,
        active: t.hasAttribute('folder-active'),
        height: t.getBoundingClientRect().height,
        opacity: getComputedStyle(t).opacity,
        style: t.getAttribute('style')
      }))));
    gBrowser.selectedTab = h.prefix; await idle(h.group);
    assert(h.group.groupContainer.getBoundingClientRect().height <= 1, 'leaving active folder must close remaining room');
    assert(!h.group.isZenFolder, 'ordinary group must remain ordinary');
  });
  // Native DOM objects and real native move APIs, with a deliberately late placing callback.
  // Mouse/drag events in these race fixtures are synthetic, not physical trackpad acceptance.
  function gesture(h, source, target, before, lateMove = true) {
    gURLBar.focus(); // Descendant blur on mousedown must not clear the captured source.
    const from = source.getBoundingClientRect(), to = target.getBoundingClientRect();
    const x = to.left + Math.min(30, to.width / 2), y = before ? to.top + 2 : to.bottom - 2;
    assert(to.height > 5 && to.width > 5, 'real target must be visible');
    source.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true, button: 0,
      buttons: 1, clientX: from.left + 20, clientY: from.top + 10 }));
    if (h.translateRows) for (const tab of h.tabs) tab.style.transform = 'translateY(90px)';
    window.dispatchEvent(new MouseEvent('mousemove', { buttons: 1, clientX: x, clientY: y }));
    // Model the asynchronous native/Zia placing boundary using its observable busy flag.
    // The move itself is performed by the real gBrowser, which emits native TabMove/Ungrouped.
    assert(document.querySelector('.zsf-drop-guide') && !document.querySelector('.zsf-drop-guide').hidden, 'gesture must resolve a real visible drop guide');
    const strip = gBrowser.tabContainer;
    if (lateMove) {
      queueMicrotask(() => strip.setAttribute('zia-settling', 'true'));
      setTimeout(() => {
        if (h.nativeUngroups) gBrowser.ungroupTab(source);
        else gBrowser.moveTabAfter(source, h.tabs[3]);
        for (const tab of h.tabs) tab.style.removeProperty('transform');
        setTimeout(() => strip.removeAttribute('zia-settling'), 30);
      }, 120);
    }
    window.dispatchEvent(new DragEvent('drop', { clientX: x, clientY: y, bubbles: true }));
    window.dispatchEvent(new DragEvent('dragend', { clientX: x, clientY: y, bubbles: true }));
    return { x, y };
  }
  await test('in-folder drop waits for late native move and uses pre-drag layout', async h => {
    const [A, B, C, D] = h.tabs;
    const moves = [];
    const listener = event => { if (h.tabs.includes(event.target)) moves.push(event.type); };
    gBrowser.tabContainer.addEventListener('TabMove', listener);
    try {
      h.translateRows = true;
      gesture(h, C, A, true);
      await delay(650); await idle(h.group);
      assert(same(order(h.group), [C, A, B, D]), 'C must land before A, got ' + names(order(h.group)));
      gesture(h, C, B, false);
      await delay(650); await idle(h.group);
      assert(same(order(h.group), [A, B, C, D]), 'consecutive drag to middle must persist');
      assert(moves.length >= 3, 'test must execute native move events');
    } finally { gBrowser.tabContainer.removeEventListener('TabMove', listener); }
  });
  await test('whole group drag animates neighbour avoidance and clears on Escape', async h => {
    const head=h.group.querySelector(':scope > .tab-group-label-container');
    const first=h.prefix;
    first.scrollIntoView({block:'nearest'});
    await delay(250);
    const from=head.getBoundingClientRect(), to=first.getBoundingClientRect();
    assert(from.height>10 && to.height>10, 'group and target row must have real geometry');
    const x=to.left+Math.min(24,to.width/2), y=to.top+3;
    head.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,composed:true,
      button:0,buttons:1,clientX:from.left+20,clientY:from.top+10}));
    window.dispatchEvent(new MouseEvent('mousemove',{buttons:1,clientX:x,clientY:y}));
    assert(h.group.hasAttribute('data-zsf-drag-source'), 'dragging folder must expose its floating card');
    assert(first.hasAttribute('data-zsf-drag-avoid'), 'ordinary sibling must enter the avoidance path');
    assert(parseFloat(first.style.getPropertyValue('--zsf-drag-avoid-y'))>15,
      'target neighbour must move down to make a visual group slot');
    await delay(90);
    const opacity=Number(getComputedStyle(head).opacity);
    assert(opacity<.05, 'native source grey bar must be hidden while group ghost is visible: '+opacity);
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert(!first.hasAttribute('data-zsf-drag-avoid') &&
      !first.style.getPropertyValue('--zsf-drag-avoid-y'),
      'Escape must remove group avoidance on the actual Zen tab');
    assert(!h.group.hasAttribute('data-zsf-drag-source'),'Escape clears native-source mask');
    assert(same(order(h.group),h.tabs),'group animation never mutates member order');
  });
  await test('drag edge autoscroll moves ordinary Space list without a drop', async h => {
    const scroll=gZenWorkspaces.activeWorkspaceElement.scrollbox?.scrollbox;
    assert(scroll && scroll.scrollHeight>scroll.clientHeight+90,
      'fixture must have a scrollable real Zen arrowscrollbox');
    scroll.scrollTop=0;
    await delay(900);
    const initial=scroll.scrollTop;
    const head=h.group.querySelector(':scope > .tab-group-label-container');
    head.scrollIntoView({block:'nearest',behavior:'instant'});
    await delay(120);
    const from=head.getBoundingClientRect(), box=scroll.getBoundingClientRect();
    assert(from.height>5,'source group label must be visible');
    const x=Math.max(box.left+30,from.left+20), y=box.bottom-12;
    head.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,composed:true,
      button:0,buttons:1,clientX:from.left+20,clientY:from.top+10}));
    window.dispatchEvent(new MouseEvent('mousemove',{buttons:1,clientX:x,clientY:y}));
    await delay(250);
    assert(scroll.scrollTop>initial+10,'drag near lower edge must auto-scroll visible tab rows: '+
      JSON.stringify({initial,actual:scroll.scrollTop,bottom:box.bottom}));
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    const halted=scroll.scrollTop;
    await delay(110);
    assert(Math.abs(scroll.scrollTop-halted)<4,'scrolling must stop after Escape');
    assert(same(order(h.group),h.tabs),'edge scrolling must never move members without a drop');
  });
  await test('whole group can reach first ordinary slot', async h => {
    const normal = () => [...root().children].filter(node => node.localName === 'tab-group' ||
      (gBrowser.isTab(node) && !node.pinned && !node.hasAttribute('zen-empty-tab')));
    const first = normal()[0];
    gBrowser.moveTabAfter(h.group, first);
    first.scrollIntoView({ block: 'start' });
    await idle(h.group);
    const head = h.group.querySelector(':scope > .tab-group-label-container');
    const target = first.localName === 'tab-group' ? first.querySelector(':scope > .tab-group-label-container') : first;
    const from = head.getBoundingClientRect(), to = target.getBoundingClientRect();
    const x = to.left + 25, y = to.top + 1;
    head.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, composed:true, button:0, buttons:1,
      clientX:from.left + 25, clientY:from.top + 10 }));
    window.dispatchEvent(new MouseEvent('mousemove', { buttons:1, clientX:x, clientY:y }));
    window.dispatchEvent(new DragEvent('drop', { bubbles:true, clientX:x, clientY:y }));
    window.dispatchEvent(new DragEvent('dragend', { bubbles:true, clientX:x, clientY:y }));
    await delay(650); await idle(h.group);
    assert(normal()[0] === h.group, 'group must land before first ordinary element');
    assert(same(order(h.group), h.tabs), 'moving the group must preserve its members');
  });
  await test('accepted same-folder drop survives a native transient ungroup', async h => {
    h.nativeUngroups = true;
    gesture(h, h.tabs[2], h.tabs[0], true);
    await delay(650); await idle(h.group);
    assert(same(order(h.group), [h.tabs[2], h.tabs[0], h.tabs[1], h.tabs[3]]), 'only the original accepted member may return to its original folder');
  });
  await test('new gesture cancels an older pending correction', async h => {
    gesture(h, h.tabs[2], h.tabs[0], true);
    window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    await delay(650);
    assert(same(order(h.group), [h.tabs[0], h.tabs[1], h.tabs[3], h.tabs[2]]), 'stale correction must not replay after another gesture');
  });
  await test('ungroup waits for pending drop and preserves native DOM identity/order', async h => {
    snapshot(h);
    gesture(h, h.tabs[2], h.tabs[0], true);
    const result = await core.ungroupInDisplayOrder(h.group, h.tabs.slice());
    assert(!result.errors && result.ordered, 'ungroup must verify completion: ' + JSON.stringify(result));
    const flat = [...root().querySelectorAll('tab')].filter(tab => h.tabs.includes(tab));
    assert(same(flat, [h.tabs[2], h.tabs[0], h.tabs[1], h.tabs[3]]), 'ungroup must use accepted drop order, got ' + names(flat));
    await delay(650);
    assert(same([...root().querySelectorAll('tab')].filter(tab => h.tabs.includes(tab)), flat), 'native asynchronous events must not change ungrouped order');
    assert(h.tabs.every(tab => !tab.group), 'all same tab objects must be outside group');
    assert(core.readSnapshots()[gZenWorkspaces.activeWorkspace], 'snapshot must remain');
  });
  await test('asynchronous native API completion is awaited before verification', async h => {
    gBrowser.moveTabBefore(h.tabs[3], h.tabs[1]);
    const expected = order(h.group).slice();
    const original = gBrowser.ungroupTab;
    gBrowser.ungroupTab = tab => new Promise((resolve, reject) => setTimeout(() => {
      try { original.call(gBrowser, tab); resolve(); } catch (error) { reject(error); }
    }, 60));
    try {
      const result = await core.ungroupInDisplayOrder(h.group);
      assert(!result.errors && result.moved === 4 && result.ordered, 'must await actual native detach, not verify early');
      assert(same([...root().querySelectorAll('tab')].filter(tab => h.tabs.includes(tab)), expected), 'asynchronous native ungroup must preserve DOM order');
    } finally { gBrowser.ungroupTab = original; }
  });
  await test('context-menu ungroup keeps visible order and active snapshot', async h => {
    gBrowser.moveTabBefore(h.tabs[3], h.tabs[0]);
    const expected = order(h.group).slice();
    const stored = snapshot(h);
    h.group.labelElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true,
      button: 2, screenX: 100, screenY: 100 }));
    const menu = [...document.querySelectorAll('menupopup')].find(node => node.zsfTargetGroup === h.group);
    assert(menu, 'actual group context menu must open');
    const command = [...menu.querySelectorAll('menuitem')].find(node => node.getAttribute('label') === '解散群組');
    assert(command, 'actual ungroup command must exist');
    command.dispatchEvent(new Event('command', { bubbles: true }));
    menu.hidePopup();
    for (let i = 0; i < 100 && h.tabs.some(tab => tab.group); i++) await delay(20);
    await delay(650);
    assert(same([...root().querySelectorAll('tab')].filter(tab => h.tabs.includes(tab)), expected), 'menu must preserve top-to-bottom DOM order');
    assert(h.tabs.every(tab => !tab.group), 'menu must detach real tab objects');
    assert(core.readSnapshots()[stored.workspaceId], 'manual ungroup must retain restore arrow snapshot');
    const archives = JSON.parse(SessionStore.getCustomWindowValue(window, 'zsf-archived-snapshots-v1'));
    assert(archives[stored.workspaceId].some(item => JSON.stringify(item.snapshot) === JSON.stringify(stored.value)), 'archive must contain exact original snapshot');
  });
  await test('safe split preserves multiple group runs and keeps recovery arrow', async h => {
    const foreign = gBrowser.addTabGroup([h.prefix], { id: 'ordinary-foreign-' + serial, label: 'Foreign', insertBefore:h.prefix, showCreateUI:false });
    const stored = snapshot(h);
    gBrowser.moveTabBefore(h.tabs[3], h.tabs[1]);
    const expected = order(h.group).slice();
    await core.rescueSiteGroups();
    await delay(650);
    assert(h.tabs.every(tab => !tab.group), 'safe split must ungroup all real tabs');
    assert(foreign.isConnected && h.prefix.group === foreign, 'foreign ordinary group must be untouched');
    assert(same([...root().querySelectorAll('tab')].filter(tab => h.tabs.includes(tab)), expected), 'safe split must keep manual DOM sequence');
    assert(core.readSnapshots()[stored.workspaceId]?.rescueCompleted, 'safe split progress and original snapshot must remain; ' + document.querySelector('.zsf-notification-text')?.getAttribute('value') + '; remaining=' + [...root().querySelectorAll('tab-group')].map(g=>g.id+':'+g.tabs.length));
    const arrow = gZenWorkspaces.activeWorkspaceElement.querySelector('.zsf-undo-button');
    assert(arrow && !arrow.hidden, 'actual restore arrow must remain visible');
  });
  await test('opening selected folder preserves glow during native expansion', async h => {
    gBrowser.selectedTab=h.tabs[1]; h.group.collapsed=true; await idle(h.group);
    h.group.collapsed=false;
    for (const wait of [0,40,100]) {
      if (wait) await delay(wait);
      const container=h.group.groupContainer, paint=getComputedStyle(container);
      if (!container.hasAttribute('zia-folder-holding')) assert(paint.overflowY==='visible' && paint.clipPath==='none',
        'opening must retain glow without an expensive expanded folder-wide clip: '+JSON.stringify({wait,overflow:paint.overflowY,clip:paint.clipPath,inline:container.style.overflowY}));
      assert(h.tabs[1].getBoundingClientRect().height>10, 'selected row remains visible during opening');
    }
    await idle(h.group);
    assert(h.group.groupContainer.getBoundingClientRect().height>60, 'normal expanded layout must remain intact');
    const settled=getComputedStyle(h.group.groupContainer);
    assert(settled.overflowY==='visible' && settled.clipPath==='none', 'selected glow must remain visible without group-wide clipping after opening');
  });
  await test('scroll offset stays fixed while opening a folder with animated sound bars', async h => {
    const space = gZenWorkspaces.activeWorkspaceElement;
    const scroll = space.scrollbox?.scrollbox;
    assert(scroll && typeof scroll.scrollTop === 'number', 'real Zen arrowscrollbox scrollport must exist');
    await delay(120); // observe the asynchronous structural group registration
    assert(space.hasAttribute('data-zsf-scroll-stable'), 'owning Space must opt out of anchoring, not every native workspace');
    // This triggers Zia's CSS sound bars on a REAL tab without requiring a
    // remote video stream; video decode/GPU contention is a physical follow-up.
    const tab = h.tabs[1];
    tab.setAttribute('soundplaying', 'true');
    tab.dispatchEvent(new CustomEvent('TabAttrModified', {
      bubbles: true, detail: { changed: ['soundplaying'] }
    }));
    await delay(150);
    assert(tab.hasAttribute('soundplaying'), 'animated sound-bar state retained');
    assert(scroll.scrollHeight > scroll.clientHeight + 80,
      'must test overflow, not a scrollport that cannot move');
    gBrowser.selectedTab = tab;
    h.group.collapsed = true;
    await idle(h.group);
    const wanted = Math.min(180, scroll.scrollHeight - scroll.clientHeight - 30);
    scroll.scrollTop = wanted;
    // Zen's arrowscrollbox supports smooth scrolling. Setting scrollTop
    // starts an asynchronous scroll animation in some versions, so an
    // immediate measurement would incorrectly attribute that motion to
    // expanding the folder. Require a fully settled baseline first.
    await delay(900);
    const start = scroll.scrollTop;
    assert(start > 30 && Math.abs(start - wanted) <= 2,
      'baseline must be at a stable nonzero position before opening: ' +
      JSON.stringify({start, wanted}));
    const samples = [start];
    h.group.collapsed = false;
    // Sample mid-animation and after settling, not just the final frame.
    for (const ms of [30, 50, 90, 120, 230]) {
      await delay(ms);
      samples.push(scroll.scrollTop);
    }
    await idle(h.group);
    samples.push(scroll.scrollTop);
    assert(samples.every(n => Math.abs(n - start) <= 2),
      'native folder animation must not scroll sidebar when video sound indicator is active: ' +
      JSON.stringify({ start, samples }));
    assert(h.group.groupContainer.getBoundingClientRect().height > 60,
      'sound wave must not cancel native folder expansion');
  });
  await test('Zia spring remains when soundplaying tab is selected inside folder', async h => {
    const tab = h.tabs[1];
    tab.setAttribute('soundplaying', 'true');
    tab.dispatchEvent(new CustomEvent('TabAttrModified', {
      bubbles: true, detail: { changed: ['soundplaying'] }
    }));
    gBrowser.selectedTab = tab;
    await delay(120);
    h.group.collapsed = true;
    await idle(h.group);
    const capturing = () => [h.group.groupStartElement, h.group.groupContainer, ...h.tabs]
      .flatMap(el => el?.getAnimations?.() || [])
      .map(anim => Number(anim.effect?.getTiming?.().duration) || 0);
    h.group.collapsed = false;
    // Zia's native selected-item path may animate children rather than the
    // group start. Check the whole group for a spring-scale duration.
    await delay(40);
    const timings = capturing();
    assert(timings.some(n => n >= 320),
      'soundplaying selected tab must not lose the Zia/Zen spring duration: ' +
      JSON.stringify(timings));
    await idle(h.group);
    assert(tab.getBoundingClientRect().height > 10 &&
      h.group.groupContainer.getBoundingClientRect().height > 60,
      'selected tab and group remain fully visible with audio indicator');
  });
  await test('changing selected soundplaying tab inside collapsed group uses one native path', async h => {
    const tab = h.tabs[0];
    tab.setAttribute('soundplaying', 'true');
    tab.dispatchEvent(new CustomEvent('TabAttrModified', {
      bubbles: true, detail: { changed: ['soundplaying'] }
    }));
    gBrowser.selectedTab = tab;
    h.group.collapsed = true;
    await idle(h.group);
    const zen = window.gZenFolders;
    const nativeExpand = zen.animateExpand;
    const nativeCollapse = zen.animateCollapse;
    let expansions = 0, collapses = 0;
    zen.animateExpand = function (group, ...args) {
      if (group === h.group) expansions++;
      return nativeExpand.call(this, group, ...args);
    };
    zen.animateCollapse = function (group, ...args) {
      if (group === h.group) collapses++;
      return nativeCollapse.call(this, group, ...args);
    };
    try {
      gBrowser.selectedTab = h.tabs[1];
      await delay(120);
      await idle(h.group);
      assert(expansions === 0, 'changing selected tab while closed must not launch a competing expansion: ' + expansions);
      assert(collapses <= 1, 'event and attribute observers must coalesce to one collapse: ' + collapses);
      assert(h.tabs[1].getBoundingClientRect().height > 10,
        'newly selected tab must remain visible inside closed folder');
      assert(h.tabs[0].getBoundingClientRect().height <= 1,
        'former selected soundplaying tab must no longer occupy a visible row');
      assert(Number(getComputedStyle(h.tabs[1]).opacity) > .9,
        'newly selected tab must not retain opacity 0');
    } finally {
      zen.animateExpand = nativeExpand;
      zen.animateCollapse = nativeCollapse;
    }
  });
  await test('simultaneous collapsed groups keep headers as actual hit targets', async h => {
    const [A,B,C,D] = h.tabs;
    gBrowser.ungroupTab(C); gBrowser.ungroupTab(D);
    const second = gBrowser.addTabGroup([C], {id:'zsf-hit-second',label:'Second',insertBefore:h.suffix,showCreateUI:false});
    const third = gBrowser.addTabGroup([D], {id:'zsf-hit-third',label:'Third',insertBefore:h.suffix,showCreateUI:false});
    for (const group of [second,third]) group.setAttribute('data-zsf-site','github.com');
    await delay(500);
    gBrowser.selectedTab = A;
    second.collapsed = true; third.collapsed = true; h.group.collapsed = true;
    await Promise.all([idle(second),idle(third),idle(h.group)]);
    const state = [second,third].map(group=>({id:group.id,hidden:group.groupContainer.hidden,
      height:group.groupContainer.getBoundingClientRect().height,overflow:getComputedStyle(group.groupContainer).overflowY}));
    assert(state.every(item=>item.hidden && item.height<=1), 'every inactive group must settle independently; '+JSON.stringify(state));
    function deepest(x,y) {
      let node=document.elementFromPoint(x,y);
      for(let i=0;i<12 && node?.shadowRoot;i++) {
        const next=node.shadowRoot.elementFromPoint(x,y);
        if(!next || next===node) break;
        node=next;
      }
      return node;
    }
    for(const group of [h.group,second,third]) {
      group.scrollIntoView({block:'nearest',behavior:'instant'});
      const header=group.querySelector(':scope > .tab-group-label-container');
      const box=header.getBoundingClientRect();
      // Group rows can extend beyond the sidebar's clipped scrollport.
      // A user can only click the intersection visible inside the toolbox.
      const sidebar=document.getElementById('navigator-toolbox').getBoundingClientRect();
      const left=Math.max(box.left,sidebar.left,0), right=Math.min(box.right,sidebar.right,innerWidth);
      const top=Math.max(box.top,sidebar.top,0), bottom=Math.min(box.bottom,sidebar.bottom,innerHeight);
      assert(right-left>4 && bottom-top>4, 'header must be visible inside sidebar: '+JSON.stringify({box:box.toJSON(),sidebar:sidebar.toJSON()}));
      const hit=deepest(left+Math.min(24,(right-left)/2),(top+bottom)/2);
      assert(header.contains(hit), 'click point for '+group.id+' must hit its own header, got '+hit?.localName+'#'+hit?.id+' class='+hit?.getAttribute?.('class')+' src='+hit?.getAttribute?.('src')+' in '+hit?.closest?.('tab-group')?.id+' target='+JSON.stringify({box:box.toJSON(),sidebar:sidebar.toJSON(),point:[left+Math.min(24,(right-left)/2),(top+bottom)/2],hitBox:hit?.getBoundingClientRect?.().toJSON()}));
    }
  });
  await test('manual ungroup of collapsed selected group restores every row visibly', async h => {
    snapshot(h); gBrowser.selectedTab=h.tabs[1]; h.group.collapsed=true; await idle(h.group);
    const result=await core.ungroupInDisplayOrder(h.group);
    await delay(650);
    assert(!result.errors && result.ordered, 'ungroup must finish successfully');
    const states=h.tabs.map(tab=>({name:tab.zsfTestName,height:tab.getBoundingClientRect().height,opacity:getComputedStyle(tab).opacity}));
    assert(states.every(row=>row.height>10 && Number(row.opacity)>.9), 'ungrouped rows must actually be visible; '+JSON.stringify(states));
  });
  await test('safe split of collapsed selected group restores every row visibly', async h => {
    snapshot(h); gBrowser.selectedTab=h.tabs[1]; h.group.collapsed=true; await idle(h.group);
    await core.rescueSiteGroups(); await delay(650);
    const states=h.tabs.map(tab=>({name:tab.zsfTestName,height:tab.getBoundingClientRect().height,opacity:getComputedStyle(tab).opacity}));
    assert(h.tabs.every(tab=>!tab.group), 'safe split must detach original tabs');
    assert(states.every(row=>row.height>10 && Number(row.opacity)>.9), 'split rows must actually be visible; '+JSON.stringify(states));
  });
  await test('undo from collapsed selected group restores every row visibly', async h => {
    const stored = snapshot(h);
    gBrowser.selectedTab = h.tabs[1];
    h.group.collapsed = true;
    await idle(h.group);
    const before = h.tabs.map(tab => ({ name:tab.zsfTestName, height:tab.getBoundingClientRect().height,
      opacity:getComputedStyle(tab).opacity, inline:tab.getAttribute('style') }));
    assert(before.some(row => row.height <= 1), 'fixture must contain genuinely collapsed rows');
    await core.undo();
    await delay(650);
    const after = h.tabs.map(tab => ({ name:tab.zsfTestName, height:tab.getBoundingClientRect().height,
      opacity:getComputedStyle(tab).opacity, inline:tab.getAttribute('style'), hidden:tab.hidden }));
    assert(h.tabs.every(tab => !tab.group), 'undo must detach the original tab objects');
    assert(same([...root().querySelectorAll('tab')].filter(tab => h.tabs.includes(tab)),h.tabs), 'undo must retain original order');
    assert(after.every(row => row.height > 10 && Number(row.opacity) > .9 && !row.hidden),
      'every restored standalone row must actually be visible; before='+JSON.stringify(before)+'; after='+JSON.stringify(after));
    assert(!core.readSnapshots()[stored.workspaceId], 'only fully verified undo may clear snapshot');
  });
  await test('SessionStore undo restores original standalone sequence without replacing tabs', async h => {
    const stored = snapshot(h);
    gBrowser.moveTabBefore(h.tabs[3], h.tabs[0]);
    await core.undo(); await delay(650);
    assert(h.tabs.every(tab => !tab.group), 'undo returns original standalone tabs');
    assert(same([...root().querySelectorAll('tab')].filter(tab => h.tabs.includes(tab)), h.tabs), 'undo must restore captured A B C D');
    assert(!core.readSnapshots()[stored.workspaceId], 'successful verified undo may clear its snapshot');
  });
  return { results, eventMode: 'synthetic chrome input plus real native APIs/events/animations; no physical input claim' };
})().then(finish, error => finish({ results: [{ name: 'suite', status: 'FAIL', error: String(error.message || error) + '\n' + (error.stack || '') }] }));
