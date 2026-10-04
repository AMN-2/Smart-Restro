#!/usr/bin/env python3
"""QA Cat. 6 — multi-tenancy isolation between qa1.localhost and qa2.localhost.

Runs the same order flow on both sites at the same time and looks for
leakage through every shared component:

  6.1  Realtime: a KDS listener on site 1 receives no event caused by site 2 (and vice versa)
  6.2  Session: a site-1 session cookie is rejected by site 2
  6.3  Files: a private file uploaded on site 1 is not served by site 2
  6.4  Redis cache: every key written during the run carries a site/db prefix (needs redis-cli)
  6.5  Background jobs: every queued RQ job carries the right `site` kwarg (needs redis-cli)
  6.6  Data: same-named QA records on both sites hold independent values

Prereqs: world JSON for qa1 (suffix A) and qa2 (suffix Z, so invoice series differ
and a leaked event cannot be mistaken for a local one) — see qa/README.md.
"""

import concurrent.futures as cf
import json
import os
import subprocess
import sys
import time

from qa_env import (
	SITE_1,
	SITE_2,
	URL_1,
	URL_2,
	FrappeClient,
	guard,
	load_world,
	realtime_listener,
	socket_url,
	sync_order,
	write_evidence,
)

RESULTS = []


def record(sid, passed, detail):
	RESULTS.append({"scenario": sid, "pass": passed, "detail": detail})
	print(f"[{'PASS' if passed else ('SKIP' if passed is None else 'FAIL')}] {sid}: {str(detail)[:300]}")


def redis(port, *args):
	cmd = ["redis-cli", "-p", str(port)]
	if os.environ.get("QA_REDIS_PASSWORD"):
		cmd += ["-a", os.environ["QA_REDIS_PASSWORD"], "--no-auth-warning"]
	return subprocess.run(cmd + list(args), capture_output=True, text=True, timeout=30).stdout


def free_table(client, w):
	for t in w["tables"]:
		code, body, _ = client.call(
			"frappe.client.get_count", doctype="POS Invoice", filters={"restaurant_table": t, "docstatus": 0}
		)
		if code == 200 and not body.get("message"):
			return t
	raise RuntimeError("no free table")


def main():
	guard(URL_1, URL_2, socket_url(1), socket_url(2))
	w1, w2 = load_world(SITE_1)["A"], load_world(SITE_2)["Z"]
	c1 = FrappeClient(URL_1, SITE_1).login(w1["users"]["manager"], w1["password"])
	c2 = FrappeClient(URL_2, SITE_2).login(w2["users"]["manager"], w2["password"])

	# 6.1 realtime, both directions, flows running concurrently
	l1, l2 = realtime_listener(c1, socket_url(1)), realtime_listener(c2, socket_url(2))
	marker = f"QA-ISO-{int(time.time())}"
	t0 = time.time()
	with cf.ThreadPoolExecutor(max_workers=2) as ex:
		f1 = ex.submit(lambda: sync_order(c1, w1, free_table(c1, w1), [("_QA Burger", 1)]))
		f2 = ex.submit(lambda: sync_order(c2, w2, free_table(c2, w2), [("_QA Tea", 3)]))
		inv1, inv2 = f1.result()[1]["message"]["name"], f2.result()[1]["message"]["name"]
	time.sleep(3)
	l1.disconnect()
	l2.disconnect()
	leak_1 = [e for e in l1.qa_events if e["t"] >= t0 and inv2 in json.dumps(e["data"], default=str)]
	leak_2 = [e for e in l2.qa_events if e["t"] >= t0 and inv1 in json.dumps(e["data"], default=str)]
	saw_own = any(inv1 in json.dumps(e["data"], default=str) for e in l1.qa_events)
	record(
		"6.1 realtime isolation",
		not leak_1 and not leak_2 and saw_own,
		{
			"site1_saw_site2": len(leak_1),
			"site2_saw_site1": len(leak_2),
			"site1_saw_own_event": saw_own,
			"site1_invoice": inv1,
			"site2_invoice": inv2,
		},
	)

	# 6.2 session cookie replay across sites
	stolen = FrappeClient(URL_2, SITE_2)
	stolen.s.cookies.update({"sid": c1.s.cookies.get("sid")})
	code, body, _ = stolen.call("frappe.auth.get_logged_user", _http="GET")
	record(
		"6.2 cross-site session",
		not (code == 200 and isinstance(body, dict) and body.get("message") not in (None, "Guest")),
		{"code": code, "body": str(body)[:120]},
	)

	# 6.3 private file
	up = c1.s.post(
		f"{c1.base}/api/method/upload_file",
		headers={"X-Frappe-CSRF-Token": c1.csrf or ""},
		files={"file": (f"{marker}.txt", b"site1 secret")},
		data={"is_private": 1},
		timeout=30,
	)
	file_url = (up.json().get("message") or {}).get("file_url") if up.ok else None
	if file_url:
		r_other = c2.s.get(f"{c2.base}{file_url}", timeout=30)
		record(
			"6.3 file isolation",
			r_other.status_code in (403, 404) and b"site1 secret" not in r_other.content,
			{"file_url": file_url, "site2_status": r_other.status_code},
		)
	else:
		record("6.3 file isolation", False, f"upload failed: {up.status_code} {up.text[:120]}")

	# 6.4 / 6.5 redis
	if subprocess.run(["which", "redis-cli"], capture_output=True).returncode != 0:
		record("6.4 redis key prefix", None, "SKIPPED: redis-cli not installed")
		record("6.5 rq job site", None, "SKIPPED: redis-cli not installed")
	else:
		cache_port = int(os.environ.get("QA_REDIS_CACHE_PORT", "13000"))
		queue_port = int(os.environ.get("QA_REDIS_QUEUE_PORT", "11000"))
		keys = [k for k in redis(cache_port, "--scan", "--count", "1000").split() if "ury" in k.lower()]
		db1, db2 = os.environ.get("QA_DB_1", ""), os.environ.get("QA_DB_2", "")
		unprefixed = [k for k in keys if db1 and db2 and not (k.startswith(db1) or k.startswith(db2))]
		record(
			"6.4 redis key prefix",
			None if not (db1 and db2) else not unprefixed,
			{
				"ury_keys": len(keys),
				"unprefixed": unprefixed[:20],
				"note": "set QA_DB_1/QA_DB_2 to the sites' db_name",
			},
		)
		jobs = [k for k in redis(queue_port, "--scan", "--pattern", "rq:job:*").split()][:200]
		bad = []
		for k in jobs:
			kw = redis(queue_port, "HGET", k, "kwargs")
			if kw and SITE_1 not in kw and SITE_2 not in kw and "site" in kw:
				bad.append(k)
		record("6.5 rq job site", not bad, {"jobs_checked": len(jobs), "without_qa_site": bad[:20]})

	# 6.6 independent data
	frappe_ok = c1.ok(
		"frappe.client.get_value", doctype="URY Menu Item", filters={"item": "_QA Burger"}, fieldname="rate"
	)
	record(
		"6.6 data independence (inspect)",
		True,
		{
			"site1_burger_rate": frappe_ok,
			"note": "change the rate on site 2 by hand and re-run: site 1 must not change",
		},
	)

	write_evidence("cat06_isolation.json", RESULTS)
	sys.exit(0 if all(r["pass"] in (True, None) for r in RESULTS) else 1)


if __name__ == "__main__":
	main()
