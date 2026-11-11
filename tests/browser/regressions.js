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
    if (caseName.includes('scroll offset') || caseName.includes('drag edge') || caseName.includes('bottom-up group pointer') || caseName.includes('bottom-edge first upward motion')) {
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
    // Zia's native whole-folder drop is stateful, so validate it in the
    // dedicated, fresh-profile CI step rather than after 21 fixtures have
    // left native animations and workspace history in the same process.
    // Test discarded tabs separately as well, since moving and restoring
    // them changes the workspace observed by later cases.
    if (!selectedCase && ((name.startsWith('site v072 ') || name.startsWith('site v073 ') || name.startsWith('site v075 ')) ||
        name.startsWith('Zia single-controller group drop lands at the displayed slot') ||
        name.startsWith('native member drag edge scroll') ||
        (window.__ziaLoaded === true && name.startsWith('whole group drag animates neighbour avoidance')) ||
        name.startsWith('incremental organize puts incoming tabs above existing members') ||
        name.startsWith('background tab sorting preserves inactive tab')))
      return;
    try {
      const h = await fixture(name);
      // This integration case must create actual unpinned browser tabs.
      // Every ordinary case still retains the strict no-add/remove guard.
      if (name.startsWith('incremental organize puts incoming tabs above existing members') ||
          (name.startsWith('site v072 ') || name.startsWith('site v073 ')))
        await fn(h);
      else await guarded(h, () => fn(h));
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
  await test('background tab sorting preserves inactive tab and ordinary click', async h => {
    const backgroundDrag = window.__zsfBackgroundDragV090;
    assert(backgroundDrag?.debug().enabled, 'background drag must be enabled');
    const input = {window, document, navigator, console,
      setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window)};
    Services.scriptloader.loadSubScript('chrome://remote/content/external/EventUtils.js', input);

    async function reorder(source, target) {
      if (Services.appinfo.OS !== 'Linux') {
        await input.synthesizePlainDragAndDrop({
          srcElement: source, srcX: 80, srcY: 16, stepX: 0, stepY: 9,
          destElement: target, finalX: 80, finalY: 28,
        });
        return;
      }

      // Headless Linux dispatches dragstart but does not start an OS drag
      // session. Supply the DOM drag events and let Zen build the payload.
      const transfer = new DataTransfer();
      const from = source.getBoundingClientRect(), to = target.getBoundingClientRect();
      const x = from.left + 80, start = from.top + 16, end = to.top + 28;
      const send = (node, type, y) => node.dispatchEvent(new DragEvent(type, {
        bubbles: true, composed: true, cancelable: true, dataTransfer: transfer,
        clientX: x, clientY: y, screenX: window.mozInnerScreenX + x,
        screenY: window.mozInnerScreenY + y,
      }));
      input.synthesizeMouse(source, 80, 16, {type: 'mousedown'}, window);
      send(source, 'dragstart', start);
      assert(transfer.mozItemCount === 1 &&
        transfer.mozGetDataAt('application/x-moz-tabbrowser-tab', 0) === source,
        'Zen must put only the dragged tab in the payload');
      send(target, 'dragenter', end);
      send(target, 'dragover', end);
      await delay(0);
      send(target, 'drop', end);
      Object.defineProperty(transfer, 'dropEffect', {value: 'move'});
      send(source, 'dragend', end);
      input.synthesizeMouse(target, 80, 28, {type: 'mouseup'}, window);
      await delay(0);
    }

    const selected = [], restored = [];
    const onSelect = event => selected.push(event.target);
    const onRestore = event => restored.push(event.target);
    gBrowser.tabContainer.addEventListener('TabSelect', onSelect);
    gBrowser.tabContainer.addEventListener('SSTabRestoring', onRestore);
    try {
      const [a, b, c, d] = h.tabs;
      for (const tab of [a, b, c, d]) {
        gBrowser.discardBrowser(tab);
        assert(tab.hasAttribute('pending'), 'fixture must actually discard ' + tab.zsfTestName);
      }
      for (const [source, target] of [[a, c], [b, d], [c, b]]) {
        const before = [...gBrowser.tabs].indexOf(source);
        await reorder(source, target);
        assert(source.isConnected && [...gBrowser.tabs].indexOf(source) !== before,
          'drag must actually reorder ' + source.zsfTestName);
        assert(gBrowser.selectedTab === h.prefix && source.hasAttribute('pending'),
          'drag must preserve the active tab and keep ' + source.zsfTestName + ' unloaded');
      }
      assert(!selected.length && !restored.length,
        'no dragged tab may be selected or even transiently restored');

      // Wait for synthetic Linux drops to finish painting their final hit target.
      if (Services.appinfo.OS === 'Linux') await delay(450);
      input.synthesizeMouse(c, 80, 16, {type: 'mousedown'}, window);
      assert(gBrowser.selectedTab === h.prefix && c.hasAttribute('pending'),
        'pressing a tab must still leave it asleep');
      input.synthesizeMouse(c, 80, 16, {type: 'mouseup'}, window);
      assert(gBrowser.selectedTab === c && same(selected, [c]),
        'an ordinary click must select exactly the clicked tab: ' +
        JSON.stringify({active: gBrowser.selectedTab.zsfTestName, selected: names(selected)}));
    } finally {
      gBrowser.tabContainer.removeEventListener('TabSelect', onSelect);
      gBrowser.tabContainer.removeEventListener('SSTabRestoring', onRestore);
    }
  });
  await test('grouped tab real opening time persists independently of sorting', async h => {
    const openedKey = 'zsf-opened-at-real-v1';
    const saved = h.tabs.map(tab => Number(SessionStore.getCustomTabValue(tab, openedKey)));
    assert(saved.every(time => Number.isFinite(time) && time > Date.now() - 60000),
      'freshly created browser tabs must have real opening timestamps');
    const orderKey = 'zsf-created-at-v1';
    const first = h.tabs[0];
    SessionStore.setCustomTabValue(first, orderKey, String(saved[0] - 86400000));
    assert(Number(SessionStore.getCustomTabValue(first, openedKey)) === saved[0],
      'opening time must not be tied to the sort-order field');
    h.group.collapsed = true;
    await delay(80);
    h.group.collapsed = false;
    await delay(80);
    assert(h.tabs.every((tab,i) => Number(SessionStore.getCustomTabValue(tab, openedKey)) === saved[i]),
      'folding, grouping and expanding must preserve time without loading tabs');
  });
  await test('incremental organize puts incoming tabs above existing members', async h => {
    const principal = Services.scriptSecurityManager.getSystemPrincipal();
    const add = uri => gBrowser.addTab(uri, { triggeringPrincipal: principal });
    const initial = [add('about:robots'), add('about:license')];
    await delay(350);
    const group = gBrowser.addTabGroup(initial, { id:'zsf-incremental-'+serial,
      label:'About', insertBefore:initial[0], showCreateUI:false });
    group.setAttribute('data-zsf-site','internal:about');
    group.collapsed=false;
    await delay(150);
    assert(initial.every(t=>t.group===group),'baseline site group must contain original members');
    const site = tab => tab.linkedBrowser?.currentURI?.spec || '';
    assert(initial.every(t=>/^about:(robots|license)/.test(site(t))),
      'actual internal page URLs are required for this test: '+initial.map(site));
    // User manually reorders existing group members; incremental organize
    // must not sort them just to bring new arrivals to the top.
    gBrowser.moveTabBefore(initial[1],initial[0]);
    const preserved=[initial[1],initial[0]];
    assert(same(order(group),preserved),'manual order must be established');
    const incoming=[add('about:about'),add('about:mozilla')];
    await delay(400);
    assert(incoming.every(t=>/^about:(about|mozilla)/.test(site(t))),
      'new tabs must expose their actual internal URLs: '+incoming.map(site));
    const stamps=[Date.now()+2,Date.now()+3];
    for(let i=0;i<incoming.length;i++)
      SessionStore.setCustomTabValue(incoming[i], 'zsf-created-at-v1',String(stamps[i]));
    const originalBrowsers=[...initial,...incoming].map(t=>t.linkedBrowser);
    await core.organize();
    await delay(120);
    assert(same(order(group),[incoming[1],incoming[0],...preserved]),
      'newest incoming tab must be at group top, existing manual order preserved: '+
      JSON.stringify(order(group).map(site)));
    assert([...initial,...incoming].every((t,i)=>t.isConnected && !t.pinned &&
      t.linkedBrowser===originalBrowsers[i] && t.group===group),
      'organize must preserve original tab objects, ownership and pin status');
    // No new eligible tab: idempotent run must not disturb manual ordering.
    await core.organize();
    assert(same(order(group),[incoming[1],incoming[0],...preserved]),
      'second organize with no newcomers must be a no-op');
  });

  const addSiteTab = url => gBrowser.addTab(url, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
  });
  await test('site v072 singleton organizer and second-click snapshot', async h => {
    const a=addSiteTab('about:robots');
    await delay(280);
    const linked=a.linkedBrowser;
    await core.organize();
    await delay(90);
    assert(a.isConnected && !a.group,
      'a site with only one eligible tab must remain independent');
    assert([...root().children].indexOf(a)>[...root().children].indexOf(h.group),
      'standalone site tab must be below the last group');
    const ss=() => JSON.parse(SessionStore.getCustomWindowValue(window,'zsf-before-sort-v1'));
    const before=ss()[gZenWorkspaces.activeWorkspace];
    assert(before?.version===4,'first organize must preserve current positions');
    const b=addSiteTab('about:license');
    await delay(280);
    await core.organize();
    await delay(90);
    assert(a.group && b.group===a.group && !a.pinned && !b.pinned,
      'second same-site page must create exactly one ordinary group');
    assert(a.linkedBrowser===linked,
      'organize must preserve the original tab and its linked browser');
    const after=ss()[gZenWorkspaces.activeWorkspace];
    const raw=SessionStore.getCustomWindowValue(window,'zsf-archived-snapshots-v1');
    const history=raw?JSON.parse(raw):{};
    assert(history[gZenWorkspaces.activeWorkspace]?.length>=1,
      'second organize must archive the previous recovery point');
    assert(after?.capturedAt>=before.capturedAt,
      'second organize must record a fresh pre-sort snapshot');
    assert(after.tabs.some(t=>t.url==='about:robots'&&t.group===null),
      'latest snapshot must preserve singleton position before it was grouped');
    await core.undo();
    await delay(120);
    assert(a.isConnected && b.isConnected && !a.group && !b.group,
      'Undo must restore the second-click state with two independent pages');
    assert(a.linkedBrowser===linked,
      'Undo must preserve tab identity and live browser without reloading');
    const top=[...root().children];
    assert(top.indexOf(a)>top.indexOf(h.group),
      'Undo must restore first singleton to its pre-second-organize slot');
  });
  await test('site v072 selected remaining group tab stays in place', async h => {
    const a=addSiteTab('about:robots'),b=addSiteTab('about:license');
    await delay(250);
    const group=gBrowser.addTabGroup([a,b],{
      id:'zsf-single-selected-'+serial,label:'About',
      insertBefore:h.group,showCreateUI:false
    });
    group.setAttribute('data-zsf-site','internal:about');
    group.collapsed=false;
    gBrowser.selectedTab=a;
    const linked=a.linkedBrowser;
    gBrowser.removeTab(b,{animate:false});
    await delay(600);
    assert(a.isConnected&&!a.group&&!a.pinned,
      'selected final tab must auto-dissolve');
    assert(gBrowser.selectedTab===a&&a.linkedBrowser===linked,
      'selected tab and browser identity must stay the same');
    const nodes=[...root().children];
    assert(nodes.indexOf(a)>=0&&nodes.indexOf(a)<nodes.indexOf(h.group),
      'selected final tab must occupy the former group slot');
  });
  await test('site v072 background remaining tab sorts without moving parked tab', async h => {
    const a=addSiteTab('about:robots'),b=addSiteTab('about:license');
    const parked=addSiteTab('about:mozilla');
    await delay(250);
    const group=gBrowser.addTabGroup([a,b],{
      id:'zsf-single-background-'+serial,label:'About',
      insertBefore:h.group,showCreateUI:false
    });
    group.setAttribute('data-zsf-site','internal:about');
    group.collapsed=false;
    gBrowser.moveTabBefore(parked,group);
    gBrowser.selectedTab=h.prefix;
    const linked=a.linkedBrowser;
    gBrowser.removeTab(b,{animate:false});
    await delay(600);
    assert(a.isConnected&&!a.group&&!a.pinned,
      'background final tab must auto-dissolve');
    assert(a.linkedBrowser===linked,
      'background final tab must retain the linked browser');
    const nodes=[...root().children];
    assert(nodes.indexOf(a)>nodes.indexOf(h.group),
      'background final tab must move after all ordinary groups');
    assert(nodes.indexOf(parked)<nodes.indexOf(h.group),
      'manually positioned independent page above groups must stay there');
  });
  await test('site v073 collapsed background preview close leaves visible survivor', async h => {
    // ZSF preview's close action calls removeTab(tab, {animate:true}); unlike
    // v0.7.2's uncollapsed animate:false test, Zen/Zia closed-folder CSS can
    // leave a fill:forwards animation on its last background member.
    const a=addSiteTab('about:robots'),b=addSiteTab('about:license');
    await delay(260);
    const group=gBrowser.addTabGroup([a,b],{
      id:'zsf-collapsed-background-'+serial,label:'About',
      insertBefore:h.group,showCreateUI:false
    });
    group.setAttribute('data-zsf-site','internal:about');
    gBrowser.selectedTab=h.prefix;
    group.collapsed=true;
    await delay(320);
    assert(group.collapsed,'fixture must be collapsed before closing');
    const linked=a.linkedBrowser;
    gBrowser.removeTab(b,{animate:true});
    await delay(1050);
    assert(a.isConnected && !a.group && !a.pinned,
      'collapsed background group must auto-ungroup the real survivor');
    assert(a.linkedBrowser===linked,
      'collapsed survivor must retain its original linked browser');
    const nodes=[...root().children];
    assert(nodes.indexOf(a)>nodes.indexOf(h.group),
      'background survivor must move into the independent tail');
    const style=getComputedStyle(a),rect=a.getBoundingClientRect();
    assert(!a.hidden &&
      style.display!=='none' && style.visibility!=='hidden' &&
      Number(style.opacity)>0.1 && rect.height>10,
      'surviving independent tab must PAINT visibly after native close: '+
      JSON.stringify({hidden:a.hidden,display:style.display,visibility:style.visibility,
        opacity:style.opacity,height:rect.height,inlineHeight:a.style.height,
        inlineOpacity:a.style.opacity,animations:a.getAnimations?.().map(x=>x.playState)}));
  });
  await test('site v075 light theme label matches Zia sidebar ink', async h => {
    // The translucent ZSF group deliberately sets the Zia folder swatch
    // transparent, but that swatch must NOT tint its label into transparency
    // when Zia marks a light-coloured Space.
    const html=document.documentElement;
    const wasLight=html.hasAttribute('zia-light');
    const label=h.group.querySelector(':scope > .tab-group-label-container > .tab-group-label');
    assert(label && h.group.hasAttribute('data-zsf-site'),
      'fixture needs a real native ZSF group label');
    const before=getComputedStyle(label).color;
    try {
      html.removeAttribute('zia-light');
      // The underlying Zen colour palette may itself be light even without
      // Zia's marker; never assume this control state must have white text.
      const withoutMarker=getComputedStyle(label).color;
      html.setAttribute('zia-light','');
      const actual=getComputedStyle(label).color;
      const rgba=actual.match(/[\d.]+/g)?.map(Number) || [];
      assert(rgba.length>=3 && rgba[0]<85 && rgba[1]<85 && rgba[2]<85 &&
          (rgba.length<4 || rgba[3]>=0.95),
        'light mode ZSF label must use opaque Zia dark ink, not transparent swatch: '+actual);
      assert(h.group.isConnected && h.tabs.every(tab => tab.group===h.group),
        'style test cannot change group/tab ownership or tab count');
      html.removeAttribute('zia-light');
      assert(getComputedStyle(label).color===withoutMarker,
        'removing light marker must restore the exact original unmarked colour');
    } finally {
      html.toggleAttribute('zia-light',wasLight);
    }
    assert(getComputedStyle(label).color===before,
      'restoring the original theme marker must restore the original label colour');
  });
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
  // Unlike a mocked container, this creates a REAL nested Zen split.
  // In v0.7.9 the groupStart's collapsed negative margin survived opening:
  // GitHub rows rendered over Bilibili/Cloudflare instead of taking up space.
  await test('nested split expanded folder has nonoverlapping native layout', async h => {
    assert(typeof gZenViewSplitter?.splitTabs === 'function', 'Zen split API must be available');
    const [a, b] = [h.tabs[1], h.tabs[2]];
    gZenViewSplitter.splitTabs([a, b], 'grid');
    await delay(450);
    const split = a.group;
    assert(split === b.group && split?.hasAttribute('split-view-group'),
      'two tabs become a genuine native split group');
    // Zen creates a split wrapper as a top-level group even if its tabs
    // previously belonged to a Site Folder. Reproduce the user's actual
    // gesture by moving that wrapper into the existing group's container,
    // the same native DOM operation Zia uses for nested folder drops.
    h.group.groupContainer.appendChild(split);
    await delay(180);
    assert(split.group === h.group || split.closest('tab-group[data-zsf-site]') === h.group,
      'the native split wrapper must now be nested in the Site Folder');
    click(h.group); await idle(h.group);
    assert(h.group.collapsed, 'native click must close split-bearing Site Folder');
    click(h.group); await idle(h.group);
    assert(!h.group.collapsed, 'native click must expand split-bearing Site Folder');
    const margin = parseFloat(h.group.groupStartElement.style.marginTop) || 0;
    assert(Math.abs(margin) < 3, 'expanded start margin must be zero, got '+margin);
    const rect = node => node.getBoundingClientRect();
    // The native drop appends the split AFTER the existing ordinary rows.
    // Check actual DOM order rather than assuming the split sorts between B/C.
    const rows = [...h.group.groupContainer.children]
      .filter(node => node === split || node === h.tabs[0] || node === h.tabs[3]);
    assert(rows.length === 3, 'two normal members and one nested split remain');
    const rects = rows.map(rect);
    assert(rects.every(box => box.height > 12),
      'other members and split wrapper must have full native heights');
    assert(rects.every((box, i) => i === 0 || box.top >= rects[i-1].bottom - 3),
      'expanded native rows must not overlap: '+JSON.stringify({
        order: rows.map(node => node === split ? 'split' : node.zsfTestName),
        rects:rects.map(box => box.toJSON()), margin}));
    assert(a.label && b.label, 'both original split tab names are retained');
    // Mimic the next gesture in the user's video: the same split is moved
    // out, then back into an ALREADY expanded site group. Native Zen
    // should not replay its expand animation merely due to membership.
    const root=h.group.parentElement;
    root.insertBefore(split,h.group.nextElementSibling);
    await delay(40); // snapshot the native split-exit boundary, not the settled end
    const beforeOverflow=h.group.groupContainer.style.overflowY;
    const beforeMargin=h.group.groupStartElement.style.marginTop;
    assert(beforeOverflow !== 'hidden',
      'split exit must NOT start a redundant native animation: '+JSON.stringify({
        overflow:beforeOverflow,margin:beforeMargin,closed:h.group.collapsed,
        hidden:h.group.groupContainer.hidden
      }));
    h.group.groupContainer.appendChild(split);
    await delay(40);  // sample while an erroneous 180 ms expand would run
    assert(h.group.groupContainer.style.overflowY !== 'hidden',
      'split re-entry must not restart native expanded folder clipping: '+JSON.stringify({
        beforeOverflow,beforeMargin,overflow:h.group.groupContainer.style.overflowY,
        margin:h.group.groupStartElement.style.marginTop,hidden:h.group.groupContainer.hidden,
        collapsed:h.group.collapsed
      }));
    assert(Math.abs(parseFloat(h.group.groupStartElement.style.marginTop)||0) < 3,
      'split re-entry into open folder must not leave negative spacer margin');
    await idle(h.group);
    const after = [...h.group.groupContainer.children]
      .filter(node => node === split || node === h.tabs[0] || node === h.tabs[3])
      .map(rect);
    assert(after.every((box,i) => i===0 || box.top>=after[i-1].bottom-3),
      'split re-entry must preserve ordered nonoverlapping boxes');
    assert(h.tabs.every(tab => tab.isConnected && !tab.pinned),
      'all tabs survive with unchanged pinned state');
  });

  await test('native split cannot join ordinary groups during a drag', async h => {
    assert(typeof gZenViewSplitter?.splitTabs === 'function',
      'Zen split-view API must exist');
    const [a,b]=[h.tabs[1],h.tabs[2]];
    gZenViewSplitter.splitTabs([a,b],'grid');
    await delay(450);
    const split=a.group;
    assert(split === b.group && split?.hasAttribute('split-view-group'),
      'two original tabs must become one native split');
    assert(split.parentElement === root(), 'split must start outside ordinary group');
    const gate=window.__zsfSplitGuardV1;
    assert(gate && !gate.status().active, 'guard must start dormant');
    // Exercise the actual Zia/native entrypoint, not only the debug arm().
    const from=a.getBoundingClientRect(), x=from.left+Math.min(24,from.width/2),
      y=from.top+Math.min(12,from.height/2), transfer=new DataTransfer();
    a.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,composed:true,
      button:0,buttons:1,clientX:x,clientY:y}));
    a.dispatchEvent(new DragEvent('dragstart',{bubbles:true,composed:true,
      dataTransfer:transfer,clientX:x,clientY:y}));
    assert(gate.status().active,
      'the real native split dragstart must automatically arm admission protection');
    const box=h.group.groupContainer, normal=h.tabs[0];
    const attempts=[
      () => box.appendChild(split),
      () => box.insertBefore(split,normal),
      () => normal.before(split),
      () => normal.after(split),
      () => gBrowser.moveTabBefore(split,normal),
      () => gBrowser.moveTabAfter(split,normal),
      () => h.group.appendChild(split)
    ];
    for(const attempt of attempts) {
      attempt();
      assert(split.parentElement===root() && !h.group.contains(split),
        'split may not enter group through any browser/DOM insertion path');
    }
    assert(gate.status().blocked>=attempts.length,
      'all rejected insertions must be blocked before DOM mutation');
    gBrowser.moveTabBefore(split,h.group);
    assert(split.parentElement===root(),
      'a native split may still reorder before a top-level group');
    window.dispatchEvent(new DragEvent('dragend',{bubbles:true,composed:true,
      dataTransfer:transfer,clientX:x,clientY:y}));
    await delay(90);
    assert(!gate.status().active, 'dragend must restore all original methods automatically');
    // A second gesture must install a fresh hook: prevent stale WeakMap keys.
    assert(gate.arm(a), 'second split drag must re-arm after cleanup');
    box.appendChild(split);
    assert(split.parentElement===root(),'second split drag must also reject admission');
    gate.disarm();
    assert(h.tabs.every(tab=>tab.isConnected && !tab.pinned),
      'all real tabs and pinned states must survive');
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
    assert(document.querySelector('.zsf-drag-ghost') &&
      !document.querySelector('.zsf-drop-guide'),
      'only native avoidance and floating preview should appear during dragging');
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
    const first=h.prefix;
    // Enforce a known pre-drag order rather than depending on Zen's restored
    // default position; otherwise "move before prefix" can be a no-op.
    gBrowser.moveTabAfter(h.group, first);
    await idle(h.group);
    const head=h.group.querySelector(':scope > .tab-group-label-container');
    first.scrollIntoView({block:'nearest'});
    await delay(250);
    const from=head.getBoundingClientRect(), to=first.getBoundingClientRect();
    assert(from.height>10 && to.height>10, 'group and target row must have real geometry');
    const x=to.left+Math.min(24,to.width/2), y=to.top+3;
    head.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,composed:true,
      button:0,buttons:1,clientX:from.left+20,clientY:from.top+10}));
    window.dispatchEvent(new MouseEvent('mousemove',{buttons:1,clientX:x,clientY:y}));
    assert(h.group.hasAttribute('data-zsf-drag-source'),
      'dragging folder must expose its floating card: ' +
        JSON.stringify({state:drag.debugDrag?.(h.group),
          syntheticTrusted:new MouseEvent('mousemove').isTrusted,
          down:{x:from.left+20,y:from.top+10},move:{x,y}}));
    assert(first.hasAttribute('data-zsf-drag-avoid'), 'ordinary sibling must enter the avoidance path');
    const docked = document.querySelector('.zsf-drag-ghost[data-zsf-docked]');
    assert(docked && !document.querySelector('.zsf-drop-guide'),
      'whole-folder drag must show its real destination as one native-style docked row');
    const expectedTop = to.top;
    const paintedTop = Number.parseFloat(docked.style.top);
    assert(Math.abs(paintedTop-expectedTop)<5,
      'live folder preview must already occupy the FINAL intended slot: ' +
        JSON.stringify({paintedTop,expectedTop}));
    const shift=parseFloat(first.style.getPropertyValue('--zsf-drag-avoid-y'));
    assert(shift>15,
      'target neighbour must move down to make a visual group slot: ' +
      JSON.stringify({ shift, sourceTop:from.top, targetTop:to.top,
        guess:drag.chooseSlot({kind:'group',item:h.group,parent:h.group.parentElement},x,y)?.target?.id,
        order:[...h.group.parentElement.children].filter(n =>
          n.localName==='tab-group'||gBrowser.isTab(n)).map(n=>n.id) }));
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
  await test('native member drag edge scroll keeps the source visible at takeover', async h => {
    const tab=h.tabs[1], box=tab.getBoundingClientRect();
    const x=box.left+24, y=box.top+12;
    tab.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,composed:true,
      button:0,buttons:1,clientX:x,clientY:y}));
    window.dispatchEvent(new MouseEvent('mousemove',{buttons:1,clientX:x,clientY:y+15}));
    assert(!tab.hasAttribute('data-zsf-drag-member') && !document.querySelector('.zsf-drag-ghost'),
      'with Zia loaded, pointer movement must NOT start a competing fallback preview');
    const transfer=new DataTransfer();
    tab.dispatchEvent(new DragEvent('dragstart',{bubbles:true,composed:true,
      dataTransfer:transfer,clientX:x,clientY:y+15}));
    assert(document.documentElement.hasAttribute('zia-dragging-tab'), 'native tab must be accepted by Zia');
    assert(!tab.hasAttribute('data-zsf-drag-member') &&
      !document.querySelector('.zsf-drag-ghost'),
      'takeover must remove fallback source hiding and card BEFORE any dragover');
    const space=gZenWorkspaces.activeWorkspaceElement;
    const port=space.scrollbox?.scrollbox || space.scrollbox;
    const initial=port.scrollTop;
    for (const dy of [80,160,80,0]) {
      port.scrollTop=initial+dy;
      tab.dispatchEvent(new DragEvent('dragover',{bubbles:true,composed:true,
        dataTransfer:transfer,clientX:x,clientY:y+45}));
      await delay(25);
      const style=getComputedStyle(tab), r=tab.getBoundingClientRect();
      assert(style.visibility !== 'hidden' && Number(style.opacity)>.9 && r.height>5,
        'native member must stay drawn during down/up scrolling');
      assert(!tab.hasAttribute('data-zsf-drag-member'), 'no fallback opacity may return');
    }
    window.dispatchEvent(new DragEvent('dragend',{bubbles:true,composed:true}));
    await delay(150);
    assert(tab.group===h.group && same(order(h.group),h.tabs),
      'cancelled native scroll must retain all members and their order');
  });
  await test('bottom-edge first upward motion preserves grab point', async h => {
    assert(window.__ziaLoaded === true, 'must load real Zia');
    const group = h.group;
    const space = gZenWorkspaces.activeWorkspaceElement;
    const port = space.scrollbox?.scrollbox || space.scrollbox;
    const after = [...root().querySelectorAll('tab')].filter(tab =>
      tab.group !== group && !tab.pinned && !tab.hasAttribute('zen-empty-tab')).at(-1);
    assert(port && after, 'must have real scrollport and trailing tab');
    gBrowser.moveTabAfter(group, after);
    group.collapsed = true;
    await idle(group);
    const max = Math.max(0, port.scrollHeight - port.clientHeight);
    assert(max > 150, 'scrollport needs a meaningful bottom boundary');
    port.scrollTo({top:max, behavior:'instant'});
    await delay(120);
    const head = group.querySelector(':scope > .tab-group-label-container');
    const from = head.getBoundingClientRect();
    assert(from.height > 8 && from.bottom <= innerHeight+5, 'last group header visible at scroll bottom');
    assert(Math.abs(port.scrollTop - (port.scrollHeight-port.clientHeight)) < 2,
      'fixture must be truly at scrollTopMax');
    const x = from.left+Math.min(24,from.width/2), downY=from.top + from.height/2;
    const grabOffset=downY-from.top;
    const before={scrollTop:port.scrollTop, max:port.scrollHeight-port.clientHeight,
      scrollHeight:port.scrollHeight, clientHeight:port.clientHeight,
      headerTop:from.top, headerBottom:from.bottom};
    const transfer = new DataTransfer();
    head.dispatchEvent(new MouseEvent('mousedown', {bubbles:true,composed:true,
      button:0,buttons:1,clientX:x,clientY:downY}));
    head.dispatchEvent(new DragEvent('dragstart',{bubbles:true,composed:true,
      dataTransfer:transfer,buttons:1,clientX:x,clientY:downY}));
    assert(drag.debugDrag(group)?.ziaDelegate, 'Zia must own dragged group');
    const samples=[];
    try {
      for(const move of [24,58,85]) {
        const y=downY-move;
        head.dispatchEvent(new DragEvent('dragover',{bubbles:true,composed:true,
          dataTransfer:transfer,buttons:1,clientX:x,clientY:y}));
        await delay(25);
        const rect=head.getBoundingClientRect();
        samples.push({dy:move,scrollTop:port.scrollTop,
          max:port.scrollHeight-port.clientHeight,
          scrollHeight:port.scrollHeight, visualTop:rect.top,
          pointerY:y, error:Math.round((rect.top+grabOffset-y)*100)/100,
          cssTransform:group.style.getPropertyValue('transform'),
          bridge:drag.debugDrag(group)?.ziaLayoutCorrection});
      }
    } finally {
      window.dispatchEvent(new DragEvent('dragend',{bubbles:true,composed:true,
        dataTransfer:transfer,buttons:1,clientX:x,clientY:downY-85}));
      await delay(90);
    }
    assert(samples.every(x=>Math.abs(x.error)<8),
      'bottom boundary may not consume the first pointer movement: '+
      JSON.stringify({before,samples}));
  });
  await test('bottom-up group pointer remains anchored during upward sidebar scroll', async h => {
    assert(window.__ziaLoaded === true, 'requires actual Zia native group drag');
    const group = h.group;
    const space = gZenWorkspaces.activeWorkspaceElement;
    const port = space.scrollbox?.scrollbox || space.scrollbox;
    assert(port && port.scrollHeight > port.clientHeight + 180,
      'test must have an overflowing actual Zen sidebar');
    const after = [...root().querySelectorAll('tab')].filter(tab =>
      tab.group !== group && !tab.pinned && !tab.hasAttribute('zen-empty-tab')).at(-1);
    assert(after, 'ordinary tab below group required');
    gBrowser.moveTabAfter(group, after);
    // Match the reported bottom-of-sidebar gesture: the group immediately
    // above the dragged last group still shows its one selected member.
    const selectedAbove = gBrowser.addTabGroup([h.prefix], {
      id:'zsf-active-above-'+serial, label:'Active', insertBefore:h.prefix,
      showCreateUI:false
    });
    selectedAbove.setAttribute('data-zsf-site','active.example');
    // Two members: opening the selected predecessor mid-drag changes the
    // dragged group's real layout top, without moving the pointer.
    gBrowser.moveTabToExistingGroup(h.suffix, selectedAbove);
    gBrowser.moveTabBefore(selectedAbove, group);
    gBrowser.selectedTab = h.prefix;
    selectedAbove.collapsed = true;
    group.collapsed = true;
    await idle(group);
    assert(h.prefix.getBoundingClientRect().height > 12 &&
      selectedAbove.getBoundingClientRect().height > group.getBoundingClientRect().height,
      'active group immediately above last dragged group must show its selected row');
    const max = Math.max(0, port.scrollHeight - port.clientHeight);
    assert(max >= 180, 'need 180px scroll range from bottom');
    port.scrollTo({ top:max, behavior:'instant' });
    await delay(140);
    const head = group.querySelector(':scope > .tab-group-label-container');
    const box = head.getBoundingClientRect();
    assert(box.height > 8 && box.top >= 0 && box.bottom <= innerHeight + 5,
      'last group header must be in viewport: '+JSON.stringify(box.toJSON()));
    const x = box.left + Math.min(28, box.width/2);
    const downY = box.top + Math.min(16,box.height/2);
    const offset = downY - box.top;
    const transfer = new DataTransfer();
    head.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, composed:true,
      button:0, buttons:1, clientX:x, clientY:downY }));
    head.dispatchEvent(new DragEvent('dragstart', { bubbles:true, composed:true,
      dataTransfer:transfer, clientX:x, clientY:downY, buttons:1 }));
    assert(document.documentElement.hasAttribute('zia-dragging-tab') &&
      drag.debugDrag(group)?.ziaDelegate, 'Zia must own the real source during test');
    const samples = [];
    const initialTop = port.scrollTop;
    for (const [scrollUp,moveUp] of [[0,35],[65,65],[130,95],[195,125]]) {
      // Simulate the neighbouring selected folder changing row height while
      // Zia keeps the same native drag gesture active.
      if (scrollUp === 130) {
        selectedAbove.collapsed = false;
        // The native drag is intentionally still running: nativeIdle()
        // must not be called during it. Only await the folder animation.
        if (motion.whenIdle) await motion.whenIdle(selectedAbove);
        else await delay(180);
      }
      port.scrollTo({top:Math.max(0,initialTop-scrollUp),behavior:'instant'});
      await delay(32);
      const y = downY - moveUp;
      head.dispatchEvent(new DragEvent('dragover',{bubbles:true,composed:true,
        dataTransfer:transfer, clientX:x, clientY:y, buttons:1}));
      await delay(40);
      const actual = head.getBoundingClientRect();
      samples.push({ scroll:port.scrollTop, pointer:y,
        headerTop:actual.top, anchoredPoint:actual.top+offset,
        error:Math.round((actual.top+offset-y)*100)/100,
        transform:group.style.getPropertyValue('transform') });
    }
    window.dispatchEvent(new DragEvent('dragend', { bubbles:true, composed:true,
      dataTransfer:transfer, clientX:x, clientY:downY-125 }));
    await delay(100);
    assert(samples.every(s=>Math.abs(s.error)<=8),
      'upward scrolling must keep grabbed folder under the pointer, not lag behind: '+JSON.stringify(samples));
    assert(!document.documentElement.hasAttribute('zia-dragging-tab') &&
      group.parentElement === root() && !group.isZenFolder,
      'group must restore original identity and DOM ownership after drag cancellation');
  });
  await test('Zia shared folder adapter probe', async h => {
    const g = h.group;
    const before = Object.getOwnPropertyDescriptor(g, 'isZenFolder');
    const head = g.querySelector(':scope > .tab-group-label-container');
    const from = head.getBoundingClientRect();
    try {
      assert(!g.isZenFolder, 'an ordinary website group must not be a native folder');
      const event = new DragEvent('dragstart', {
        bubbles: true, composed: true, clientX: from.left + 24,
        clientY: from.top + 12, dataTransfer: new DataTransfer()
      });
      // Sine runs this in a separate headless browser with synthetic
      // events. Prime the adapter explicitly before testing the normal
      // mousedown/fallback/late-dragstart lifecycle below.
      const prepared = typeof drag.prepareZiaGroupDrag === 'function' &&
        drag.prepareZiaGroupDrag(g);
      assert(prepared, 'Zia compatibility adapter must prime the owned group: ' +
        JSON.stringify({ zia: window.__ziaLoaded, isZenFolder:g.isZenFolder,
          match:g.matches('tab-group[data-zsf-site]:not([split-view-group])'),
          connected:g.isConnected, pinned:g.pinned, owns:g.hasAttribute('data-zsf-site'),
          groupDescriptor:String(Object.getOwnPropertyDescriptor(g,'isZenFolder')?.configurable),
          canDropExtensible:Object.isExtensible(gZenFolders),
          canDropType:typeof gZenFolders?.canDropElement }));
      assert(g.isZenFolder === true,
        'adapter must transiently expose native folder identity');
      // Reproduce the missing-dragstart interval before allowing Zia
      // to accept the later native event in this same gesture.
      head.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, composed:true,
        button:0, buttons:1, clientX:from.left+24, clientY:from.top+12}));
      window.dispatchEvent(new MouseEvent('mousemove', {buttons:1,
        clientX:from.left+24, clientY:from.top-30}));
      assert(drag.debugDrag(g).pendingKind === 'group' &&
        !g.hasAttribute('data-zsf-drag-source') && !document.querySelector('.zsf-drag-ghost'),
        'with Zia loaded, missing dragstart must retain the pending native source without fallback painting');
      head.dispatchEvent(event);
      assert(drag.debugDrag(g).ziaDelegate && !g.hasAttribute('data-zsf-drag-source'),
        'late native takeover must remove the fallback source mask');
      assert(document.documentElement.hasAttribute('zia-dragging-tab'),
        'Zia must take over the actual native group drag');
      assert(!document.querySelector('.zsf-drag-ghost'),
        'Site Folders must not run a second preview if Zia accepted the folder');
      window.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
      await delay(150);
      assert(!document.documentElement.hasAttribute('zia-dragging-tab'),
        'Zia must clean its own temporary drag state');
      assert(!g.isZenFolder,
        'the original group must NOT retain the Zen folder identity');
      assert(g.parentElement === root() && same(order(g), h.tabs),
        'single-controller drag cancellation must retain same-level group and members');
    } finally {
      if (before) Object.defineProperty(g, 'isZenFolder', before);
      else delete g.isZenFolder;
    }
  });
  for (const targetKind of ['tab','folder']) for (const direction of ['up','down'])
  await test('Zia single-controller group drop lands at the displayed slot ' + direction + ' ' + targetKind, async h => {
    const g = h.group;
    const prefix = targetKind === 'folder' ? gBrowser.addTabGroup([h.prefix], {
      label:'About',showCreateUI:false,insertBefore:h.prefix
    }) : h.prefix;
    if (targetKind === 'folder') {
      prefix.setAttribute('data-zsf-site','about');
      prefix.collapsed=true;
      await motion.whenIdle(prefix);
    }
    if (direction === 'up') gBrowser.moveTabAfter(g, prefix);
    else gBrowser.moveTabBefore(g, prefix);
    g.collapsed = true;
    await idle(g);
    prefix.scrollIntoView({block:'nearest'});
    const head = g.querySelector(':scope > .tab-group-label-container');
    const from = head.getBoundingClientRect(), to = prefix.getBoundingClientRect();
    assert(from.height>5 && to.height>5, 'native group and prefix must be visible');
    const sep=root().querySelector('.pinned-tabs-container-separator') ||
      gZenWorkspaces.activeWorkspaceElement.querySelector('.pinned-tabs-container-separator');
    const sepRect=sep?.getBoundingClientRect();
    const x=to.left+Math.min(25,to.width/2), y=to.top+Math.max(5,to.height*(direction === 'up' ? .2 : .8));
    const initial={fromTop:from.top,fromHeight:from.height,fromBottom:from.bottom,
      targetTop:to.top,targetHeight:to.height,releaseY:y,
      sepTop:sepRect?.top,sepBottom:sepRect?.bottom,
      groupPinned:g.pinned,prefixPinned:prefix.pinned,
      groupParent:g.parentElement?.className,prefixParent:prefix.parentElement?.className};
    // Store the UNWRAPPED insertion method before arming the scoped adapter.
    // Recording it after prepare would test for the temporary wrapper remaining installed.
    const originalSeparator = gZenWorkspaces.activeWorkspaceElement.querySelector('.pinned-tabs-container-separator');
    assert(originalSeparator?.parentNode, 'pinned separator parent must exist');
    const insertDescriptor = Object.getOwnPropertyDescriptor(originalSeparator.parentNode, 'insertBefore');
    const prepared = typeof drag.prepareZiaGroupDrag === 'function' &&
      drag.prepareZiaGroupDrag(g);
    assert(prepared, 'native adapter should be active before OS dragstart: ' +
      JSON.stringify({zia:window.__ziaLoaded, isZenFolder:g.isZenFolder,
        connected:g.isConnected, matches:g.matches('tab-group[data-zsf-site]:not([split-view-group])'),
        canDropType:typeof gZenFolders?.canDropElement}));
    const transfer=new DataTransfer();
    head.dispatchEvent(new DragEvent('dragstart',{bubbles:true,composed:true,
      dataTransfer:transfer,clientX:from.left+25,clientY:from.top+10}));
    assert(document.documentElement.hasAttribute('zia-dragging-tab'),
      'Zia should be the only controller of an active group drag');
    prefix.dispatchEvent(new DragEvent('dragover',{bubbles:true,composed:true,
      dataTransfer:transfer,clientX:x,clientY:y}));
    await delay(60);
    assert(!document.querySelector('.zsf-drag-ghost'),
      'Site Folders must not paint a competing landing position');
    // Zia's actual sibling row shifts BEFORE the group is dropped.
    const ziaShifted = prefix.hasAttribute('zia-shift') ||
      /translateY\([^)]*[1-9]/.test(prefix.style.getPropertyValue('transform'));
    assert(ziaShifted, 'Zia must visibly displace the target BEFORE release');
    const landings=[];
    const landingObserver=new MutationObserver(records => {
      for (const record of records)
        if ([...record.addedNodes].includes(g)) landings.push(record.target);
    });
    landingObserver.observe(gZenWorkspaces.activeWorkspaceElement,{childList:true,subtree:true});
    prefix.dispatchEvent(new DragEvent('drop',{bubbles:true,composed:true,
      dataTransfer:transfer,clientX:x,clientY:y}));
    window.dispatchEvent(new DragEvent('dragend',{bubbles:true,composed:true,
      dataTransfer:transfer,clientX:x,clientY:y}));
    await delay(350);
    landingObserver.disconnect();
    assert(Object.getOwnPropertyDescriptor(sep.parentNode,'insertBefore')?.value === insertDescriptor?.value,
      'scoped native insertion adapter must be restored after landing');
    assert(landings.length <= 1 && landings.every(parent => parent === root()),
      'folder must never land in a pinned/wrong container, even transiently: ' +
      JSON.stringify(landings.map(parent => parent.className)));
    const topLevel=[...root().children].filter(n =>
      n.localName==='tab-group'||gBrowser.isTab(n));
    assert(topLevel.indexOf(g)===topLevel.indexOf(prefix)+(direction === 'up' ? -1 : 1),
      'group must land exactly before target, not jump to a delayed second slot: ' +
      JSON.stringify({topLevel:topLevel.map(n=>({id:n.id,kind:n.localName,
        label:n.getAttribute('label'),site:n.getAttribute('data-zsf-site')})),
        gIndex:topLevel.indexOf(g),prefixIndex:topLevel.indexOf(prefix),
        groupParent:g.parentElement?.localName,
        groupParentClass:g.parentElement?.className,
        groupParentParent:g.parentElement?.parentElement?.id,
        groupPrev:g.previousElementSibling?.id, groupNext:g.nextElementSibling?.id,
        folder:g.isZenFolder,
        rootZia:document.documentElement.hasAttribute('zia-dragging-tab'),
        prefixShift:prefix.style.getPropertyValue('transform'),
        sourceTransform:g.style.getPropertyValue('transform'), initial}));
    assert(g.parentElement===root() && !g.isZenFolder,
      'group remains top-level and ordinary after Zia drop');
    assert(same(order(g),h.tabs),'Zia drop must not change member order or identity');
  });
  return { results, eventMode: 'synthetic chrome input plus real native APIs/events/animations; no physical input claim' };
})().then(finish, error => finish({ results: [{ name: 'suite', status: 'FAIL', error: String(error.message || error) + '\n' + (error.stack || '') }] }));
