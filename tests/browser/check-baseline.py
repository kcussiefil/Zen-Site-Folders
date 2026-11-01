import json, sys
report = json.load(open(sys.argv[1]))
assert not report.get('runnerError'), report.get('runnerError')
expected = [
    'native collapse/expand, rapid reversal and selected row',
    'in-folder drop waits for late native move and uses pre-drag layout',
    'ungroup waits for pending drop and preserves native DOM identity/order',
]
results = {r['name']: r for r in report['results']}
for name in expected:
    assert results.get(name, {}).get('status') == 'FAIL', 'Baseline did not reproduce: ' + name
print('PASS: unchanged v0.3.7 reproduces all three required native regressions')
