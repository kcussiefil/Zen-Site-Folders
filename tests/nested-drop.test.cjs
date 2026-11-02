// Controlled integration, not a macOS visual acceptance test.
// Runs the actual installed Zia landing functions against a small DOM model.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourcePath = process.argv[2] || path.resolve(__dirname, '../site-folders-drag.uc.js');
// Optional actual-source integration; the portable default exercises the same DOM fallbacks.
const zia = process.env.ZIA_SOURCE ? fs.readFileSync(process.env.ZIA_SOURCE, 'utf8') : null;
function extract(name) {
  const start = zia.indexOf(`    const ${name} = `);
  assert(start >= 0, `missing installed Zia function: ${name}`);
  const end = zia.indexOf('\n    };', start);
  assert(end > start);
  return zia.slice(start, end + '\n    };'.length);
}
let passes = 0;
for (const targetKind of ['empty', 'closed', 'open']) {
  for (const accepted of [false, true]) {
   for (const moveToEnd of [false, true]) {
    let nestedWrites = 0, flatWrites = 0;
    let source, normal;
    class Element {
      constructor(tag) { this.localName=tag; this.children=[]; this.attrs=new Set(); this.isConnected=true; this.pinned=false; }
      get parentNode() { return this.parentElement; }
      get nextElementSibling() { const a=this.parentElement?.children||[]; return a[a.indexOf(this)+1]||null; }
      insertBefore(node, before) {
        if (node===source) { if (this===normal) flatWrites++; else nestedWrites++; }
        if (node.parentElement) node.parentElement.children.splice(node.parentElement.children.indexOf(node),1);
        const index=before?this.children.indexOf(before):this.children.length;
        assert(index>=0); this.children.splice(index,0,node); node.parentElement=this; return node;
      }
      appendChild(node) { return this.insertBefore(node,null); }
      after(node) { return this.parentElement.insertBefore(node,this.nextElementSibling); }
      before(node) { return this.parentElement.insertBefore(node,this); }
      hasAttribute(key) { return this.attrs.has(key); }
      removeAttribute(key) { this.attrs.delete(key); }
      matches() { return this===source; }
      closest(selector) {
        if (selector==='zen-workspace') return space;
        if (selector==='zen-folder' && this.localName==='zen-folder') return this;
        return this.parentElement?.closest(selector)||null;
      }
      contains(node) { return node===this || this.children.some(child=>child.contains(node)); }
      querySelector(selector) { return selector===':scope > .tab-group-container'?this.box:null; }
      querySelectorAll(selector) {
        return this.children.flatMap(child=>[
          ...((selector.includes('tab-group') && ['tab-group','zen-folder'].includes(child.localName))?[child]:[]),
          ...child.querySelectorAll(selector)
        ]);
      }
    }
    const space=new Element('zen-workspace');
    normal=new Element('normal'); const pinned=new Element('pinned');
    const separator=new Element('separator'); pinned.appendChild(separator);
    const target=new Element('zen-folder'); target.box=new Element('box'); target.appendChild(target.box);
    source=new Element('tab-group'); source.tabs=[];
    const peer=new Element('tab-group');
    normal.appendChild(source); normal.appendChild(peer); pinned.appendChild(target);
    space.appendChild(normal); space.appendChild(pinned);
    space.querySelector=()=>separator;
    const member=new Element('tab');
    if (targetKind!=='empty') target.box.appendChild(member);
    target.collapsed=targetKind==='closed';
    if (targetKind==='empty') target.attrs.add('zia-empty');
    flatWrites=0;
    const originalCanDrop=()=>true;
    const window={__ziaLoaded:true,gZenWorkspaces:{activeWorkspace:'test'},
      gZenFolders:{canDropElement:originalCanDrop,on_TabGroupCollapse(){}},
      addEventListener(){},removeEventListener(){}};
    const gBrowser=window.gBrowser={isTab:node=>node.localName==='tab',
      moveTabBefore:(node,before)=>before.parentNode.insertBefore(node,before),
      moveTabAfter:(node,after)=>after.after(node)};
    const originalAppend=target.box.appendChild, originalAfter=member.after;
    const document={readyState:'loading',documentElement:{hasAttribute:()=>false,removeAttribute(){}}};
    const context={window,document,console,setTimeout,clearTimeout,Promise,gBrowser,
      noteError:(_,error)=>{throw error;},
      isFolderEl:node=>['zen-folder','tab-group'].includes(node.localName),
      isCollapsed:node=>!!node.collapsed, jumpToEnd(){},
      topLevel:row=>row.node, currentSeparator:()=>separator};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(sourcePath,'utf8').replace(
      '  window.__zsfDragV037 = api;',
      '  window.probe={primeZiaShim,restoreZiaShim,context:()=>ziaShim?.landingContext};\n  window.__zsfDragV037 = api;'),context);
    if (zia) {
      vm.runInContext(['placeBefore','placeAfter','nextInFolder','canNest','outermostRow','finishFolderDrop']
        .map(extract).join('\n')+'\nwindow.ziaProbe={canNest,finishFolderDrop};',context);
    } else {
      // Model the insertion boundaries used by Zia 2.114.1. In particular,
      // a native API insertion can be followed by a direct DOM fallback.
      window.ziaProbe={
        canNest:(group,into)=>window.gZenFolders.canDropElement(group,into),
        finishFolderDrop(group,landing) {
          const box=landing.folder.box;
          if (landing.next) {
            const next=landing.next.node;
            gBrowser.moveTabBefore(group,next);
            if (group.nextElementSibling!==next) box.insertBefore(group,next);
          } else {
            const last=box.children.at(-1);
            if (last) {
              gBrowser.moveTabAfter(group,last);
              if (last.nextElementSibling!==group) last.after(group);
            }
            if (group.parentElement!==box) box.appendChild(group);
          }
        }
      };
    }
    assert(window.probe.primeZiaShim({kind:'group',item:source}));
    assert.equal(window.ziaProbe.canNest(source,target),false,'normal preview must reject nesting');
    assert.equal(window.gZenFolders.canDropElement(peer,member),true,'unrelated groups unaffected');
    window.probe.context().accepted=accepted;
    if (moveToEnd) window.probe.context().landingBefore=null;
    // Deliberately supply an already-selected inside target. This checks
    // the final mutation boundary independently of the preview canNest guard.
    window.ziaProbe.finishFolderDrop(source,{folder:target,atEnd:targetKind!=='open',
      next:targetKind==='open'?{node:member}:null});
    assert.equal(nestedWrites,0,`${targetKind}/${accepted}: must never enter another group's DOM`);
    assert.equal(source.parentElement,normal,`${targetKind}/${accepted}: source stays at ordinary level`);
    assert.equal(flatWrites,accepted && moveToEnd?1:0,'exactly one insertion at an accepted changed gap');
    assert.equal(source.nextElementSibling,accepted && moveToEnd?null:peer,'final position equals painted gap');
    const unrelated=new Element('tab'); target.box.appendChild(unrelated);
    assert.equal(unrelated.parentElement,target.box,'unrelated tab insertion passes through');
    window.probe.restoreZiaShim();
    assert.equal(target.box.appendChild,originalAppend);
    assert.equal(member.after,originalAfter);
    assert.equal(window.gZenFolders.canDropElement,originalCanDrop);
    assert(!Object.hasOwn(source,'isZenFolder'));
    passes++;
   }
  }
}
console.log(`PASS: ${passes} ${zia?"actual-Zia":"modeled-Zia"} landing cases: empty/closed/open, accepted/cancelled, no transient nesting, unrelated insertion and wrapper cleanup.`);
