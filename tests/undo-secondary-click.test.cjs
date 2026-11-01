const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname,'..','site-folders.uc.js'),'utf8');
new vm.Script(source);
const injected = source.replace(
  "  if (document.readyState === 'complete') initialize();",
  "  window.__zsfTestRightClick = onUndoSecondaryClick;\n  if (document.readyState === 'complete') initialize();"
);
assert.notEqual(source, injected, 'injection anchor must exist');
const queued = [];
const store = {
  getCustomWindowValue(_w, key) {
    if (key === 'zsf-before-sort-v1')
      return JSON.stringify({ space1: {version:4,createdFolders:['zsf-one'],tabs:[],elements:[]} });
    return '';
  },
  setCustomWindowValue() {},
};
const window = {
  SessionStore: store,
  gZenWorkspaces: { activeWorkspace:'space1', activeWorkspaceElement: {id:'space1'} },
  addEventListener() {}, removeEventListener() {},
};
const document = {readyState:'loading'};
vm.runInNewContext(injected, {
  window, document, console, Services: {},
  ChromeUtils: {importESModule:()=>({SessionStore:store})},
  setTimeout:fn=>{queued.push(fn);return queued.length},
  clearTimeout() {}, requestAnimationFrame() {}, cancelAnimationFrame() {}
});
const handler = window.__zsfTestRightClick;
assert.equal(typeof handler, 'function');
const button = {isConnected:true,hidden:false,disabled:false,
  classList:{contains:name=>name === 'zsf-undo-button'}};
const page = {classList:{contains:()=>false}};
function event(type,target,buttonIndex=2) {
  const counts={prevented:0,stopped:0};
  return {type,button:buttonIndex,target,
    composedPath:()=>[target],
    preventDefault(){counts.prevented++},
    stopImmediatePropagation(){counts.stopped++},
    stopPropagation(){counts.stopped++},
    counts
  };
}
const down=event('mousedown',button);
handler(down);
assert.equal(down.counts.prevented,0,'mousedown must not open a native modal');
assert.equal(queued.length,0,'rescue must not run before contextmenu');
const rightOnPageAfterDown=event('contextmenu',page);
handler(rightOnPageAfterDown);
assert.equal(rightOnPageAfterDown.counts.prevented,1,
  'trailing contextmenu must be consumed even if Zen retargets it to webpage');
assert.equal(queued.length,1,'rescue scheduled only after contextmenu was blocked');
const genuinePageRightClick=event('contextmenu',page);
handler(genuinePageRightClick);
assert.equal(genuinePageRightClick.counts.prevented,0,
  'real webpage context menu is never blocked');
assert.equal(queued.length,1,'no second rescue for a real page click');
const secondGesture=event('mousedown',page);
handler(secondGesture);
const anotherPageRightClick=event('contextmenu',page);
handler(anotherPageRightClick);
assert.equal(anotherPageRightClick.counts.prevented,0);
console.log('PASS: no mousedown modal, trailing page context menu blocked, normal webpage context menu preserved');
