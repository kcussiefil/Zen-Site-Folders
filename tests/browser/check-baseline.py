import json, sys
report = json.load(open(sys.argv[1]))
assert not report.get('runnerError'), report.get('runnerError')
expected = [
    'undo from collapsed selected group restores every row visibly',
    'manual ungroup of collapsed selected group restores every row visibly',
    'safe split of collapsed selected group restores every row visibly',
    'simultaneous collapsed groups keep headers as actual hit targets',
]
results = {r['name']: r for r in report['results']}
for name in expected:
    assert results.get(name, {}).get('status') == 'FAIL', 'Baseline did not reproduce: ' + name
print('PASS: unchanged v0.3.8 reproduces all four visible-state and hit-target regressions')
