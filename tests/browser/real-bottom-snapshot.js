const d=window.__zsfRealBottomPointer;
if(!d)return {error:'missing setup'};
const rect=d.head.getBoundingClientRect();
let nativePointer=null;
try {
  const xx={value:NaN},yy={value:NaN};
  window.windowUtils.getLastOverWindowPointerLocationInCSSPixels(xx,yy);
  nativePointer={x:xx.value,y:yy.value};
} catch(e) {nativePointer={error:String(e)};}

return {nativePointer,scrollTop:d.port.scrollTop, max:d.port.scrollHeight-d.port.clientHeight,
  headerTop:rect.top, pointerStart:d.y, grabOffset:d.grabOffset,
  error:d.pointerY==null?null:Math.round((rect.top+d.grabOffset-d.pointerY)*100)/100,
  zia:document.documentElement.hasAttribute('zia-dragging-tab'),
  delegate:window.__zsfDragV037?.debugDrag?.(d.group)?.ziaDelegate,
  bridge:window.__zsfDragV037?.debugDrag?.(d.group)?.ziaLayoutCorrection,
  events:d.events.slice(-22)};