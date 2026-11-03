#!/usr/bin/env python3
"""Compare an isolated candidate to exactly the same native regressions on v0.6.4."""
import json, pathlib, sys

baseline = json.loads(pathlib.Path(sys.argv[1]).read_text())
candidate = json.loads(pathlib.Path(sys.argv[2]).read_text())
for name, report in (("baseline", baseline), ("candidate", candidate)):
    if report.get("runnerError") or not report.get("results"):
        raise SystemExit(f"FAIL: {name} native runner failed or returned no results: {report.get('runnerError')}")
    if report.get("browser", {}).get("version") != candidate.get("browser", {}).get("version"):
        raise SystemExit("FAIL: candidate and baseline used different browser versions")
old = {item["name"]: item["status"] for item in baseline["results"]}
new = {item["name"]: item["status"] for item in candidate["results"]}
if old.keys() != new.keys():
    raise SystemExit(f"FAIL: different test cases: missing {sorted(old.keys()-new.keys())}; added {sorted(new.keys()-old.keys())}")
regressions = sorted(name for name, value in old.items() if value == "PASS" and new[name] != "PASS")
baseline_failures = sorted(name for name, value in old.items() if value != "PASS")
candidate_failures = sorted(name for name, value in new.items() if value != "PASS")
print(json.dumps({
    "baseline_version": "v0.6.4",
    "cases": len(old),
    "baseline_failure_count": len(baseline_failures),
    "candidate_failure_count": len(candidate_failures),
    "preexisting_failures": sorted(set(baseline_failures) & set(candidate_failures)),
    "candidate_fixed": sorted(set(baseline_failures) - set(candidate_failures)),
    "new_regressions": regressions
}, indent=2, ensure_ascii=False))
if regressions:
    raise SystemExit("FAIL: candidate broke native cases that pass on v0.6.4")
print("PASS: candidate has no new failures against the same native regression suite on v0.6.4")
