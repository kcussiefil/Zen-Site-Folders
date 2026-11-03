const finish = arguments[arguments.length - 1];
(async () => {
  const make = label => gBrowser.addTab('about:blank#zsf-real-'+label, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
  });
  const before = make('prior');
  const groupTabs = [make('siteA'),make('siteB')];
  for (let n=0;n<40;n++) make('overflow'+n);
  const group = gBrowser.addTabGroup(groupTabs,{id:'zsf-real-bottom-pointer',
    label:'Xxfuel',insertBefore:groupTabs[0],showCreateUI:false});
  group.setAttribute('data-zsf-site','xxfuel.com');
  gBrowser.moveTabAfter(group,[...gBrowser.tabs].at(-1));
  gBrowser.selectedTab=before;
  group.collapsed=true;
  await new Promise(r=>setTimeout(r,550));
  const space=gZenWorkspaces.activeWorkspaceElement;
  const port=space.scrollbox?.scrollbox || space.scrollbox;
  const max=port.scrollHeight-port.clientHeight;
  if(max<150) throw new Error('scrollbar fixture not tall enough '+max);
  port.scrollTo({top:max,behavior:'instant'});
  await new Promise(r=>setTimeout(r,120));
  const head=group.querySelector(':scope > .tab-group-label-container');
  const box=head.getBoundingClientRect();
  const x=Math.round(box.left+Math.min(35,box.width/3));
  const y=Math.round(box.top+Math.min(16,box.height/2));
  const data={group,head,port,x,y,grabOffset:y-box.top,events:[]};
  const track=event=>{
    if(!['dragstart','drag','dragenter','dragleave','dragover','dragend','mousemove','mousedown','scroll'].includes(event.type))return;
    const r=head.getBoundingClientRect();
    data.events.push({type:event.type,x:event.clientX,y:event.clientY,
      sourceTop:r.top,scrollTop:port.scrollTop,max:port.scrollHeight-port.clientHeight,
      transform:group.style.getPropertyValue('transform'),
      bridge:window.__zsfDragV037?.debugDrag?.(group)?.ziaLayoutCorrection});
    if(data.events.length>250)data.events.shift();
  };
  for(const type of ['mousedown','mousemove','dragstart','drag','dragenter','dragleave','dragover','dragend']){
    window.addEventListener(type,track,true);
  }
  port.addEventListener('scroll',track,true);
  data.cleanup=()=>{
    for(const type of ['mousedown','mousemove','dragstart','drag','dragenter','dragleave','dragover','dragend']){
      window.removeEventListener(type,track,true);
    }
    port.removeEventListener('scroll',track,true);
  };
  window.__zsfRealBottomPointer=data;
  return {x,y,portScroll:port.scrollTop,max:port.scrollHeight-port.clientHeight,
    headerTop:box.top,headerBottom:box.bottom,viewport:{width:innerWidth,height:innerHeight}};
})().then(finish,e=>finish({error:String(e.message||e)}));
