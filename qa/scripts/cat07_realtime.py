#!/usr/bin/env python3
"""QA Cat. 7 — Realtime / KDS over a real Socket.IO connection.

  7.1  Scope: a branch-B user must not receive branch-A KOT payloads (SR-010)
  7.2  Latency: order sent -> `kot_update_<branch>_<production>` received; p50/p95/max over N orders
  7.3  Disconnect/reconnect: tickets placed while offline appear exactly once in kot_list after reconnect
  7.4  Socket.IO restart with orders in flight (needs QA_ALLOW_RESTART=1 and sudo supervisorctl)
  7.5  nginx: /socket.io proxied with websocket upgrade headers (static check of the QA server config)

Prereqs: world JSON for qa1 with suffixes A,B (see qa_env.py). Run with ~/qa-tools/venv/bin/python.
"""

import os
import re
import statistics
import subprocess
import sys
import time

from qa_env import (
	SITE_1,
	URL_1,
	FrappeClient,
	guard,
	load_world,
	realtime_listener,
	socket_url,
	sync_order,
	write_evidence,
)

RESULTS = []
LATENCY_BUDGET_S = float(
	os.environ.get("QA_KDS_LATENCY_BUDGET", "2.0")
)  # NEEDS DECISION: acceptable KDS latency


def record(sid, passed, detail):
	RESULTS.append({"scenario": sid, "pass": passed, "detail": detail})
	print(f"[{'PASS' if passed else 'FAIL'}] {sid}: {str(detail)[:300]}")


def kot_channel(w):
	return f"kot_update_{w['branch']}_{w['production']}"


def wait_for(events, predicate, timeout=10.0, after=0.0):
	end = time.time() + timeout
	while time.time() < end:
		for e in events:
			if e["t"] >= after and predicate(e):
				return e
		time.sleep(0.02)
	return None


def free_table(client, w):
	for t in w["tables"]:
		code, body, _ = client.call(
			"frappe.client.get_count", doctype="POS Invoice", filters={"restaurant_table": t, "docstatus": 0}
		)
		if code == 200 and not body.get("message"):
			return t
	raise RuntimeError("no free QA table; reset the site or settle open bills")


def s1_scope(a, b):
	ca = FrappeClient(URL_1, SITE_1).login(a["users"]["cashier"], a["password"])
	cb = FrappeClient(URL_1, SITE_1).login(b["users"]["cashier"], b["password"])
	sio_b = realtime_listener(cb, socket_url(1))
	try:
		t0 = time.time()
		sync_order(ca, a, free_table(ca, a), [("_QA Burger", 1)])
		leaked = wait_for(
			sio_b.qa_events, lambda e: e["event"].startswith(f"kot_update_{a['branch']}"), timeout=5, after=t0
		)
	finally:
		sio_b.disconnect()
	record(
		"7.1 branch scope",
		leaked is None,
		{
			"branch_b_received": leaked and leaked["event"],
			"payload_keys": leaked and list((leaked["data"] or {}).keys()),
		},
	)


def s2_latency(a, n=20):
	c = FrappeClient(URL_1, SITE_1).login(a["users"]["manager"], a["password"])
	sio = realtime_listener(c, socket_url(1))
	samples, missing = [], 0
	try:
		for _ in range(n):
			table = free_table(c, a)
			t0 = time.time()
			_code, body, _ = sync_order(c, a, table, [("_QA Tea", 1)])
			ev = wait_for(sio.qa_events, lambda e: e["event"] == kot_channel(a), timeout=10, after=t0)
			if ev:
				samples.append(ev["t"] - t0)
			else:
				missing += 1
			# settle so the table frees up for the next sample
			inv = body.get("message", {}).get("name") if isinstance(body, dict) else None
			if inv:
				c.call(
					"ury.ury.doctype.ury_order.ury_order.make_invoice",
					customer=a["customer"],
					payments=[{"mode_of_payment": a["cash"], "amount": 1500}],
					cashier=a["users"]["cashier"],
					pos_profile=a["profile"],
					owner=a["users"]["manager"],
					invoice=inv,
					table=table,
				)
	finally:
		sio.disconnect()
	stats = {}
	if samples:
		q = statistics.quantiles(samples, n=20) if len(samples) >= 2 else [samples[0]] * 19
		stats = {"n": len(samples), "p50": statistics.median(samples), "p95": q[18], "max": max(samples)}
	record(
		"7.2 KDS latency",
		missing == 0 and stats.get("p95", 99) <= LATENCY_BUDGET_S,
		{"missing": missing, **stats},
	)


def s3_reconnect(a):
	c = FrappeClient(URL_1, SITE_1).login(a["users"]["manager"], a["password"])
	sio = realtime_listener(c, socket_url(1))
	sio.disconnect()
	placed = []
	for _ in range(3):
		code, body, _ = sync_order(c, a, free_table(c, a), [("_QA Burger", 1)])
		if code == 200:
			placed.append(body["message"]["name"])
	sio = realtime_listener(c, socket_url(1))
	sio.disconnect()
	board = c.ok("ury.ury.api.ury_kot_display.kot_list")
	on_board = [k.get("invoice") for k in board.get("KOT", [])]
	dupes = {inv: on_board.count(inv) for inv in placed if on_board.count(inv) != 1}
	record("7.3 reconnect resync", not dupes, {"placed": placed, "count_on_board_if_not_1": dupes})


def s4_socket_restart(a):
	if os.environ.get("QA_ALLOW_RESTART") != "1":
		record("7.4 socketio restart", None, "SKIPPED: set QA_ALLOW_RESTART=1 on the QA server")
		return
	c = FrappeClient(URL_1, SITE_1).login(a["users"]["manager"], a["password"])
	placed = []
	proc = subprocess.Popen(
		[
			"sudo",
			"supervisorctl",
			"restart",
			os.environ.get("QA_SOCKETIO_PROGRAM", "frappe-bench-node-socketio"),
		]
	)
	for _ in range(5):
		code, body, _ = sync_order(c, a, free_table(c, a), [("_QA Tea", 1)])
		placed.append((code, body.get("message", {}).get("name") if isinstance(body, dict) else None))
	proc.wait(timeout=60)
	time.sleep(3)
	board = c.ok("ury.ury.api.ury_kot_display.kot_list")
	on_board = [k.get("invoice") for k in board.get("KOT", [])]
	missing = [inv for code, inv in placed if code == 200 and inv not in on_board]
	record("7.4 socketio restart", not missing, {"placed": placed, "missing_from_board": missing})


def s5_nginx():
	path = os.environ.get("QA_NGINX_CONF", os.path.expanduser("~/frappe-bench/config/nginx.conf"))
	try:
		text = open(path).read()
	except OSError as e:
		record("7.5 nginx websocket", False, f"cannot read {path}: {e}")
		return
	blocks = re.findall(r"location /socket\.io \{(.*?)\}", text, re.S)
	good = bool(blocks) and all(
		"proxy_http_version 1.1" in b
		and re.search(r"Upgrade \$http_upgrade", b)
		and re.search(r'Connection "upgrade"', b)
		for b in blocks
	)
	record("7.5 nginx websocket", good, {"socket_io_blocks": len(blocks), "conf": path})


def main():
	guard(URL_1, socket_url(1))
	world = load_world(SITE_1)
	a, b = world["A"], world["B"]
	for fn, args in (
		(s1_scope, (a, b)),
		(s2_latency, (a,)),
		(s3_reconnect, (a,)),
		(s4_socket_restart, (a,)),
		(s5_nginx, ()),
	):
		try:
			fn(*args)
		except Exception as e:
			record(fn.__name__, False, f"script error: {e!r}")
	write_evidence("cat07_realtime.json", RESULTS)
	sys.exit(0 if all(r["pass"] in (True, None) for r in RESULTS) else 1)


if __name__ == "__main__":
	main()
