const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname,'..','site-folders-split-guard.uc.js'),'utf8');
new vm.Script(src);
const SPLIT='tab-group[split-view-group]', GROUP='tab-group:not([split-view-group]), zen-folder';
class Fake {
  constructor(localName, split=false) {this.localName=localName;this.split=split;this.children=[];this.parentNode=null;this.isConnected=true;}
  get parentElement(){return this.parentNode;}
  matches(sel){return sel===SPLIT?this.localName==='tab-group'&&this.split:
    sel===GROUP?this.localName==='zen-folder'||this.localName==='tab-group'&&!this.split:false;}
  closest(sel){for(let n=this;n;n=n.parentNode) if(n.matches?.(sel))return n;return null;}
  remove(){const p=this.parentNode;if(p)p.children.splice(p.children.indexOf(this),1);this.parentNode=null;}
  appendChild(n){n.remove();this.children.push(n);n.parentNode=this;return n;}
  insertBefore(n,ref){if(!ref)return this.appendChild(n);const i=this.children.indexOf(ref);if(i<0)throw Error('no ref');n.remove();this.children.splice(this.children.indexOf(ref),0,n);n.parentNode=this;return n;}
  replaceChild(n,ref){this.insertBefore(n,ref);ref.remove();return ref;}
  append(...nodes){for(const n of nodes)this.appendChild(n);}
  prepend(...nodes){for(const n of nodes)this.insertBefore(n,this.children[0]);}
  before(...nodes){for(const n of nodes)this.parentNode.insertBefore(n,this);}
  after(...nodes){let p=this.parentNode;let next=p.children[p.children.indexOf(this)+1];for(const n of nodes)p.insertBefore(n,next);}
  replaceWith(...nodes){this.before(...nodes);this.remove();}
  querySelector(s){return s===':scope > .tab-group-container'?this.children.find(n=>n.localName==='box')||null:null;}
  querySelectorAll(sel){let out=[];for(const n of this.children){if(n.matches(sel))out.push(n);out.push(...n.querySelectorAll(sel));}return out;}
}
const root=new Fake('root'), folder=new Fake('tab-group'), box=new Fake('box');
root.appendChild(folder);folder.appendChild(box);folder.groupContainer=box;
const normal=new Fake('tab'), other=new Fake('tab');box.appendChild(normal);root.appendChild(other);
const split=new Fake('tab-group',true), pane=new Fake('tab');root.appendChild(split);split.appendChild(pane);pane.group=split;
const listeners=[];
const win={gBrowser:{
 moveTabBefore(n,ref){return ref.parentNode.insertBefore(n,ref);},
 moveTabAfter(n,ref){return ref.after(n);},
 moveTabToExistingGroup(n,g){g.groupContainer.appendChild(n);return n;}
},addEventListener(name,fn){listeners.push([name,fn]);},removeEventListener(){}};
const doc={readyState:'complete',querySelectorAll:sel=>root.querySelectorAll(sel),
 getElementById:()=>({addEventListener(){},removeEventListener(){}}),
 documentElement:{removeAttribute(){},toggleAttribute(){}}};
vm.runInNewContext(src,{window:win,document:doc,console,setTimeout,clearTimeout});
const guard=win.__zsfSplitGuardV1;
assert(guard?.arm(pane),'guard must arm for a native split pane');
const illegal=[
 ()=>box.appendChild(split),()=>box.insertBefore(split,normal),
 ()=>normal.before(split),()=>normal.after(split),
 ()=>win.gBrowser.moveTabBefore(split,normal),()=>win.gBrowser.moveTabAfter(split,normal),
 ()=>folder.appendChild(split),()=>win.gBrowser.moveTabToExistingGroup(pane,folder)
];
for(const attempt of illegal){attempt();assert.equal(split.parentNode,root);assert.equal(pane.group,split);assert.equal(pane.parentNode,split);}
assert(guard.status().blocked>=illegal.length,'all bypass routes must be blocked');
win.gBrowser.moveTabBefore(split,folder);
assert.equal(split.parentNode,root,'same-level split reorder must remain allowed');
box.appendChild(other);
assert.equal(other.parentNode,box,'ordinary tabs must still be accepted');
guard.disarm();
assert(!guard.status().active);
assert.equal(win.gBrowser.moveTabBefore(split,normal),split,'native unrestricted path may run after cleanup');
assert.equal(split.parentNode,box,'guard was truly removed, not a permanent method hijack');
root.appendChild(split);
assert(guard.arm(pane),'rearming after restoration must work (WeakMap keys cleaned)');
box.appendChild(split);
assert.equal(split.parentNode,root,'second split drag must still be denied');
guard.destroy();
assert.equal(win.__zsfSplitGuardV1,undefined);
console.log('PASS: all split admission routes blocked while dragging; normal tabs, same-level moves, restoration and rearm');
