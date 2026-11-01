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
            result = client.async_js(pathlib.Path(__file__).with_name('regressions.js').read_text(), [args.case])['value']
            report.update(result)
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
