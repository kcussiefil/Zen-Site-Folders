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
                         'site-folders-menu.uc.js', 'site-folders-collapse.uc.js', 'site-folders-drag.uc.js']]
            styles.append(args.repo / 'userChrome.css')
            for style in styles:
                client.js('''const s=Services;
                  const ss= Cc['@mozilla.org/content/style-sheet-service;1'].getService(Ci.nsIStyleSheetService);
                  ss.loadAndRegisterSheet(s.io.newURI(arguments[0]), ss.USER_SHEET);''', [style.as_uri()])
            for script in scripts:
                client.js(script.read_text())
            if client.js("return !!document.getElementById('zia-welcome')?.matches(':popover-open');")['value']:
                raise RuntimeError('Zia first-install overlay covers native input targets')
            if args.case == 'real-bottom-pointer':
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
                        move([{'type':'pointerMove','origin':'viewport','x':x,'y':y-dy,'duration':80}])
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
