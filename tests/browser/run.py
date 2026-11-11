#!/usr/bin/env python3
"""Native chrome tests in a disposable Zen profile. Never attaches to an existing browser."""
import argparse, hashlib, json, os, pathlib, socket, subprocess, tempfile, time, shutil
from marionette_client import Marionette

parser = argparse.ArgumentParser()
parser.add_argument('--binary', required=True)
parser.add_argument('--zia-dir', type=pathlib.Path)
parser.add_argument('--repo', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[2])
parser.add_argument('--case', default='')
parser.add_argument('--output', type=pathlib.Path, required=True)
args = parser.parse_args()
args.repo = args.repo.resolve()
args.output.mkdir(parents=True, exist_ok=True)
report = {'results': [], 'mode': 'isolated-headless-native-chrome', 'physicalAcceptance': 'UNVERIFIED'}
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='zsf-native-test-') as profile:
    prefs = {
        'marionette.enabled': True, 'marionette.port': port,
        'zia.welcome.seen': '2.102.0', 'zia.welcome.show': False,
        'zia.welcome.again': False, 'zia.welcome.whats-new-again': False,
        'zen.welcome-screen.seen': True, 'browser.shell.checkDefaultBrowser': False,
        'browser.startup.page': 0, 'browser.startup.homepage': 'about:blank',
        'datareporting.policy.dataSubmissionPolicyBypassNotification': True,
        'toolkit.telemetry.reportingpolicy.firstRun': False,
        'browser.sessionstore.resume_from_crash': False,
    }
    pathlib.Path(profile, 'user.js').write_text('\n'.join(
        f'user_pref({json.dumps(key)}, {json.dumps(value)});' for key, value in prefs.items()))
    env = {**os.environ, 'MOZ_REMOTE_ALLOW_SYSTEM_ACCESS': '1', 'MOZ_HEADLESS': '1'}
    with (args.output / 'zen.log').open('w') as log:
        process = subprocess.Popen([args.binary, '--headless', '--no-remote', '--profile', profile,
                                    '--marionette', 'about:blank'], env=env, stdout=log, stderr=log)
        try:
            for attempt in range(100):
                try:
                    client = Marionette(port)
                    break
                except (ConnectionError, OSError):
                    if process.poll() is not None: raise RuntimeError('Zen exited during startup')
                    time.sleep(.1)
            else: raise RuntimeError('Dedicated Zen did not start')
            client.call('WebDriver:SetWindowRect', {'width': 1920, 'height': 1080})
            # Wait for Zen's asynchronous workspace initialization, not document.readyState alone.
            for attempt in range(100):
                if client.js('return !!window.gZenWorkspaces?.activeWorkspaceElement?.tabsContainer && !!window.gZenFolders;')['value']: break
                time.sleep(.1)
            else: raise RuntimeError('Zen workspace not initialized')
            report['sourceSHA256'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in args.repo.glob('site-folders*.uc.js')}
            report['sourceSHA256']['userChrome.css'] = hashlib.sha256((args.repo / 'userChrome.css').read_bytes()).hexdigest()
            report['browser'] = client.js('return {version:Services.appinfo.version,buildID:Services.appinfo.appBuildID,platform:Services.appinfo.OS};')['value']
            scripts = []
            styles = []
            if args.zia_dir:
                zia = args.zia_dir.resolve()
                runtime = pathlib.Path(profile, 'runtime')
                shutil.copytree(zia, runtime / 'zia')
                manifest = pathlib.Path(profile, 'chrome.manifest')
                manifest.write_text('content sine ' + runtime.as_uri() + '/\n')
                client.js('const f=Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);f.initWithPath(arguments[0]);Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(f);', [str(manifest)])
                scripts.append(zia / 'zia.uc.js')
                styles.append(zia / 'chrome.css')
                report['zia'] = {name: hashlib.sha256((zia / name).read_bytes()).hexdigest()
                                 for name in ['zia.uc.js', 'chrome.css']}
            scripts += [args.repo / name for name in ['site-folders.uc.js', 'site-folders-hover.uc.js',
                         'site-folders-menu.uc.js', 'site-folders-collapse.uc.js', 'site-folders-background-drag.uc.js',
                         'site-folders-drag.uc.js', 'site-folders-split-guard.uc.js']]
            styles.append(args.repo / 'userChrome.css')
            for style in styles:
                client.js('''const s=Services;
                  const ss= Cc['@mozilla.org/content/style-sheet-service;1'].getService(Ci.nsIStyleSheetService);
                  ss.loadAndRegisterSheet(s.io.newURI(arguments[0]), ss.USER_SHEET);''', [style.as_uri()])
            for script in scripts:
                client.js(script.read_text())
            if client.js("return !!document.getElementById('zia-welcome')?.matches(':popover-open');")['value']:
                raise RuntimeError('Zia first-install overlay covers native input targets')
            if args.case == 'separator-hover':
                # Drive real Zen+Zia with WebDriver pointer actions. CSS :hover
                # cannot be validated by synthetic mouseenter dispatch.
                fixture = client.js('''
                  const ws=gZenWorkspaces.activeWorkspaceElement;
                  const tabs=Array.from({length:3}, (_,i)=>gBrowser.addTab(
                    'about:blank#separator-fixed-right-'+i, {
                      triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()
                    }));
                  gBrowser.selectedTab=tabs[0];
                  document.documentElement.setAttribute('zen-sidebar-expanded','true');
                  Services.prefs.setBoolPref('zen.view.show-clear-tabs-button',true);
                  const sep=ws.querySelector('.pinned-tabs-container-separator');
                  const undo=sep?.querySelector('.zsf-undo-button');
                  const clear=sep?.querySelector('.zen-workspace-close-unpinned-tabs-button');
                  if(!sep || !undo || !sep.querySelector('.zsf-sort-button') || !clear)
                    throw new Error('Native Zen separator or mod controls not found');
                  ws.pinnedTabsContainer.removeAttribute('hide-separator');
                  // The selected tab is protected: Zen may remove can-close,
                  // yet the native Clear action must still work on OTHER tabs.
                  clear.removeAttribute('can-close');
                  window.__zsfTestSeparatorTabs=tabs;
                  return {separator:sep.getBoundingClientRect().toJSON(),
                    undoInitiallyHidden:undo.hidden,clearHasCanClose:clear.hasAttribute('can-close')};
                ''')['value']
                time.sleep(.3)
                def measure():
                    return client.js('''
                      const sep=gZenWorkspaces.activeWorkspaceElement.querySelector('.pinned-tabs-container-separator');
                      const q=s=>sep.querySelector(s);
                      const rect=e=>e?.getBoundingClientRect().toJSON();
                      const line=q(':scope > toolbarseparator');
                      const sort=q('.zsf-sort-button'),undo=q('.zsf-undo-button');
                      const clear=q('.zen-workspace-close-unpinned-tabs-button');
                      const icon=clear.querySelector('.toolbarbutton-icon');
                      const label=clear.querySelector('.toolbarbutton-text');
                      const show=e=>({rect:rect(e),opacity:getComputedStyle(e).opacity,
                        visibility:getComputedStyle(e).visibility,
                        display:getComputedStyle(e).display,
                        pointer:getComputedStyle(e).pointerEvents});
                      return {
                        host:rect(sep),line:rect(line),
                        sort:show(sort),undo:show(undo),clear:show(clear),
                        undoHidden:undo.hidden,
                        nativeIcon:getComputedStyle(clear).listStyleImage,
                        nativeIconDisplay:icon?getComputedStyle(icon).display:null,
                        glyphRects:Object.fromEntries([
                          ['undo',undo],['sort',sort],['clear',clear]
                        ].map(([key,btn])=>[key,btn.querySelector('.toolbarbutton-icon')
                          ?.getBoundingClientRect().toJSON()||null])),
                        glyphTransforms:Object.fromEntries([
                          ['undo',undo],['sort',sort],['clear',clear]
                        ].map(([key,btn])=>[key,getComputedStyle(
                          btn.querySelector('.toolbarbutton-icon')).transform])),
                        glyphOpacity:Object.fromEntries([
                          ['undo',undo],['sort',sort],['clear',clear]
                        ].map(([key,btn])=>[key,parseFloat(getComputedStyle(
                          btn.querySelector('.toolbarbutton-icon')).opacity)])),
                        clearLabelDisplay:label?getComputedStyle(label).display:null,
                        nativeCommand:clear.getAttribute('command'),
                        canClose:clear.hasAttribute('can-close'),
                        actualHover:sep.matches(':hover'),wave:!!q('.zsf-wave'),
                        tabLive:window.__zsfTestSeparatorTabs.filter(t=>t.isConnected).length
                      };
                    ''')['value']
                def hover_at(x,y):
                    client.call('WebDriver:PerformActions',{
                      'actions':[{'type':'pointer','id':'zsf-separator-pointer',
                        'parameters':{'pointerType':'mouse'},
                        'actions':[{'type':'pointerMove','origin':'viewport',
                          'x':int(x),'y':int(y),'duration':60}]}]})
                    time.sleep(.27)
                def click():
                    client.call('WebDriver:PerformActions',{
                      'actions':[{'type':'pointer','id':'zsf-separator-pointer',
                        'parameters':{'pointerType':'mouse'},
                        'actions':[{'type':'pointerDown','button':0},
                                   {'type':'pointerUp','button':0}]}]})
                    time.sleep(.4)
                sep=fixture['separator']
                if sep['width']<100 or sep['height']<15:
                    raise RuntimeError('Separator was unexpectedly collapsed: '+str(fixture))
                hover_at(sep['right']+75,sep['top']+sep['height']/2)
                rest=measure()
                hover_at(sep['left']+sep['width']/2,sep['top']+sep['height']/2)
                shownNoUndo=measure()
                # Test layout with an undo snapshot available: the fixture
                # temporarily reveals its icon, never changes user snapshots.
                client.js('''gZenWorkspaces.activeWorkspaceElement
                  .querySelector('.zsf-undo-button').hidden=false;''')
                time.sleep(.22)
                shownAll=measure()
                hover_at(sep['left']+sep['width']/2,sep['bottom']+32)
                after=measure()
                # Native command must remain callable with can-close absent.
                # Move the pointer back to native Clear and physically click.
                client.js('''gZenWorkspaces.activeWorkspaceElement
                  .querySelector('.zsf-undo-button').hidden=true;
                  gZenWorkspaces.activeWorkspaceElement
                  .querySelector('.zen-workspace-close-unpinned-tabs-button')
                  .removeAttribute('can-close');''')
                hover_at(sep['left']+sep['width']/2,sep['top']+sep['height']/2)
                clickPos=measure()
                clearRect=clickPos['clear']['rect']
                hover_at(clearRect['left']+clearRect['width']/2,
                  clearRect['top']+clearRect['height']/2)
                beforeClick=measure()
                click()
                afterClick=measure()
                report['separatorHover']={'fixture':fixture,'rest':rest,'noUndo':shownNoUndo,
                  'withUndo':shownAll,'afterLeave':after,
                  'beforeClick':beforeClick,'afterClick':afterClick}
                w=lambda x,k:x[k]['rect']['width']
                left=lambda x,k:x[k]['rect']['left']
                stable=lambda k:abs(left(rest,k)-left(shownNoUndo,k))<1.5 and (
                    abs(left(shownNoUndo,k)-left(shownAll,k))<1.5)
                good=(
                    fixture['undoInitiallyHidden'] and not fixture['clearHasCanClose'] and
                    rest['line']['width']>shownNoUndo['line']['width']+45 and
                    shownNoUndo['line']['width']>shownAll['line']['width']+20 and
                    after['line']['width']>shownAll['line']['width']+60 and
                    rest['line']['width']>rest['host']['width']-34 and
                    all(w(rest,k)>16 for k in ('sort','clear')) and
                    all(w(shownNoUndo,k)>16 for k in ('sort','clear')) and
                    all(stable(k) for k in ('sort','clear')) and
                    left(shownAll,'undo')<left(shownAll,'sort')<left(shownAll,'clear') and
                    all(shownAll[k]['visibility']=='visible' for k in ('undo','sort','clear')) and
                    rest['sort']['visibility']=='hidden' and
                    rest['clear']['visibility']=='hidden' and
                    shownNoUndo['undoHidden'] and
                    shownNoUndo['undo']['display']=='none' and
                    not shownAll['undoHidden'] and
                    not shownAll['canClose'] and
                    shownAll['nativeIconDisplay']!='none' and
                    all(abs(shownAll['glyphRects'][key]['width']-expected)<1 and
                            abs(shownAll['glyphRects'][key]['height']-expected)<1
                        for key,expected in (('undo',14),('sort',15),('clear',14))) and
                    all(shownAll['glyphTransforms'][key]=='none'
                        for key in ('undo','sort','clear')) and
                    abs(shownAll['glyphOpacity']['clear']-.88)<.03 and
                    'dart-down.svg' in shownAll['nativeIcon'] and
                    shownAll['clearLabelDisplay']=='none' and
                    shownAll['nativeCommand']=='cmd_zenCloseUnpinnedTabs' and
                    shownAll['wave'] and
                    beforeClick['clear']['visibility']=='visible' and
                    afterClick['tabLive'] < beforeClick['tabLive']
                )
                report['results']=[{'name':'separator-hover icons stay fixed right, undo conditional and real native Clear works',
                                    'status':'PASS' if good else 'FAIL',
                                    'reason':None if good else 'See separatorHover geometry and native click'}]
                try: client.call('WebDriver:ReleaseActions',{})
                except Exception: pass
            elif args.case == 'real-bottom-pointer':
                setup = client.async_js(pathlib.Path(__file__).with_name('real-bottom-setup.js').read_text(), [])['value']
                if setup.get('error'): raise RuntimeError('Pointer fixture: '+setup['error'])
                report['pointerFixture'] = setup
                def move(actions):
                    return client.call('WebDriver:PerformActions', {
                        'actions':[{'type':'pointer','id':'zsf-mouse','parameters':{'pointerType':'mouse'},
                                    'actions':actions}]
                    })
                samples = []
                def probe(target_y):
                    snap = client.js(pathlib.Path(__file__).with_name('real-bottom-snapshot.js').read_text())['value']
                    snap['targetY'] = target_y
                    if snap.get('error'): raise RuntimeError(str(snap['error']))
                    snap['error'] = round(snap['headerTop']+snap['grabOffset']-target_y,2)
                    samples.append(snap)
                x,y=int(setup['x']),int(setup['y'])
                try:
                    move([{'type':'pointerMove','origin':'viewport','x':x,'y':y,'duration':50}])
                    move([{'type':'pointerDown','button':0}])
                    for dy in [12,28,48,72]:
                        move([{'type':'pointerMove','origin':'viewport','x':x,'y':y-dy,'duration':260}])
                        time.sleep(.06)
                        probe(y-dy)
                finally:
                    try: move([{'type':'pointerUp','button':0}])
                    finally:
                        try: client.call('WebDriver:ReleaseActions',{})
                        except Exception: pass
                report['pointerSamples'] = samples
                moved = any(any(e.get('type')=='dragstart' for e in s['events']) for s in samples)
                anchored = moved and any(s['zia'] for s in samples) and all(abs(s['error'])<8 for s in samples if s['zia'])
                report['results'] = [{'name':'real bottom pointer starts anchored',
                                      'status':'PASS' if anchored else 'FAIL',
                                      'reason':None if anchored else 'No real dragstart or >8px drift'}]
                report['eventMode']='WebDriver pointer actions through native browser input, not synthetic dispatchEvent'
            else:
                result = client.async_js(pathlib.Path(__file__).with_name('regressions.js').read_text(), [args.case])['value']
                report.update(result)
            if any(item['status'] != 'PASS' for item in report.get('results', [])):
                import base64
                try:
                    shot = client.call('WebDriver:TakeScreenshot', {'full': False, 'scroll': False})['value']
                    (args.output / 'failure.png').write_bytes(base64.b64decode(shot))
                except Exception as error:
                    report['screenshotError'] = str(error)
        except Exception as error:
            report['runnerError'] = str(error)
        finally:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
(args.output / 'results.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
print(json.dumps(report, indent=2, ensure_ascii=False))
if report.get('runnerError') or not report['results'] or any(r['status'] != 'PASS' for r in report['results']):
    raise SystemExit(1)
