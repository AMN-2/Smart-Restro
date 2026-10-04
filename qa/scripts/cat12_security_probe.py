#!/usr/bin/env python3
"""QA Cat. 12 — HTTP-level security probe (OWASP-oriented). QA server only.

  12.1  CSRF: state-changing POST with a valid session but no CSRF token
  12.2  State-changing whitelisted methods reachable via GET (CSRF with SameSite=Lax cookies)
  12.3  CORS: credentialed cross-origin reads from an arbitrary Origin
  12.4  Error responses: no traceback / paths / SQL to a non-admin user
  12.5  IDOR: branch-A cashier reading branch-B invoice by name via /api/resource
  12.6  Rate limit on guest session minting (self-ordering bootstrap)
  12.7  Public reservation endpoint abuse (rate limit)
  12.8  Sensitive files not served (site_config, private files without session)
  12.9  Clickjacking / security headers on POS pages
  12.10 setup endpoints reachable by non-admin staff (SR-001 / SR-002), HTTP path

Configure the QA site like production first (see qa/README.md: ignore_csrf,
allow_cors, developer_mode), otherwise 12.1-12.4 test a different system.
"""

import csv
import os
import re
import sys

from qa_env import SITE_1, URL_1, FrappeClient, guard, load_world, sync_order, write_evidence

RESULTS = []
MUTATING = re.compile(
	r"(^|_)(create|update|submit|set|make|cancel|close|merge|unmerge|delete|send|sync|transfer|toggle|apply|remove|enroll|assign|reserve|record|save|dismiss|acknowledge|start|serve|recall|split|complete|confirm)",
	re.I,
)


def record(sid, passed, detail):
	RESULTS.append({"check": sid, "pass": passed, "detail": detail})
	print(f"[{'PASS' if passed else ('SKIP' if passed is None else 'FAIL')}] {sid}: {str(detail)[:300]}")


def inventory():
	path = os.path.join(
		os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "evidence", "endpoints.csv"
	)
	with open(path) as fh:
		return list(csv.DictReader(fh))


def main():
	guard(URL_1)
	w = load_world(SITE_1)
	a, b = w["A"], w["B"]
	ca = FrappeClient(URL_1, SITE_1).login(a["users"]["cashier"], a["password"])

	# 12.1 CSRF
	code, body, _ = ca.call(
		"ury.ury.doctype.ury_order.ury_order.close_table", _csrf=False, table=a["tables"][0]
	)
	record(
		"12.1 CSRF token enforced",
		code in (400, 403) and "CSRF" in str(body),
		{"code": code, "body": str(body)[:160]},
	)

	# 12.2 mutating methods over GET
	reachable = []
	for r in inventory():
		name = r["method"].rsplit(".", 1)[1]
		if r["guest"] == "yes" or r["http_methods"] != "ANY" or not MUTATING.search(name):
			continue
		code, body, _ = ca.call(r["method"], _http="GET")
		text = str(body)
		blocked = code in (403, 405) and ("not allowed" in text.lower() or "Method" in text)
		if not blocked and code != 404:
			reachable.append({"method": r["method"], "code": code, "resp": text[:80]})
	record(
		"12.2 no state change via GET", not reachable, {"count": len(reachable), "methods": reachable[:40]}
	)

	# 12.3 CORS
	r = ca.s.get(
		f"{ca.base}/api/method/frappe.auth.get_logged_user",
		headers={"Origin": "https://evil.example"},
		timeout=30,
	)
	acao, acac = (
		r.headers.get("Access-Control-Allow-Origin"),
		r.headers.get("Access-Control-Allow-Credentials"),
	)
	record(
		"12.3 no credentialed CORS for arbitrary origin",
		not (acao in ("*", "https://evil.example") and str(acac).lower() == "true"),
		{"ACAO": acao, "ACAC": acac},
	)

	# 12.4 error leakage
	code, body, _ = ca.call(
		"ury.ury.doctype.ury_order.ury_order.make_invoice",
		customer="x",
		payments="not json",
		cashier="x",
		pos_profile="does-not-exist",
		owner="x",
		invoice="does-not-exist",
	)
	text = str(body)
	leaks = [m for m in ("Traceback", "/home/", 'File "', "pymysql", "SELECT ", "frappe-bench") if m in text]
	record(
		"12.4 no internals in error response", not leaks, {"code": code, "leaks": leaks, "sample": text[:200]}
	)

	# 12.5 IDOR across branches
	cb = FrappeClient(URL_1, SITE_1).login(b["users"]["cashier"], b["password"])
	_, body_b, _ = sync_order(cb, b, b["tables"][0], [("_QA Burger", 1)])
	b_inv = body_b.get("message", {}).get("name") if isinstance(body_b, dict) else None
	if b_inv:
		code, _doc = ca.get_doc("POS Invoice", b_inv)
		record("12.5 IDOR POS Invoice by name", code in (403, 404), {"code": code, "invoice": b_inv})
	else:
		record(
			"12.5 IDOR POS Invoice by name", False, f"could not create branch-B invoice: {str(body_b)[:120]}"
		)

	# 12.6 guest bootstrap rate limit (RL_BOOTSTRAP = 30/hour)
	guest = FrappeClient(URL_1, SITE_1)
	codes = [
		guest.call("ury.ury.api.self_ordering.get_ordering_context", token="invalid")[0] for _ in range(40)
	]
	record("12.6 guest bootstrap rate-limited", 429 in codes, {"codes_tail": codes[-10:]})

	# 12.7 public reservation abuse
	# reserve is limited to 8/hour/IP; consent omitted so nothing is ever booked.
	codes = [
		guest.call(
			"ury.ury.api.restaurant_website.reserve",
			slug="qa-none",
			reserved_from="2099-01-01 20:00:00",
			no_of_pax=2,
			table="none",
			guest_name="QA",
			mobile_number="07700000000",
			request_id=f"qa-{i}",
		)[0]
		for i in range(12)
	]
	record("12.7 reservation endpoint rate-limited", 429 in codes, {"codes": codes})

	# 12.8 sensitive files
	exposed = []
	for path in (
		"/site_config.json",
		f"/{SITE_1}/site_config.json",
		"/sites/common_site_config.json",
		"/private/files/",
		"/files/../site_config.json",
		"/.git/config",
		"/assets/../../sites/common_site_config.json",
	):
		rr = guest.s.get(f"{guest.base}{path}", timeout=30)
		if rr.status_code == 200 and (
			"db_password" in rr.text or "encryption_key" in rr.text or "[core]" in rr.text
		):
			exposed.append(path)
	record("12.8 config/secrets not served", not exposed, {"exposed": exposed})

	# 12.9 clickjacking headers
	rr = ca.s.get(f"{ca.base}/pos", timeout=30)
	xfo, csp = rr.headers.get("X-Frame-Options"), rr.headers.get("Content-Security-Policy", "")
	record(
		"12.9 POS not frameable",
		bool(xfo) or "frame-ancestors" in csp,
		{"X-Frame-Options": xfo, "CSP": csp[:120]},
	)

	# 12.10 setup endpoints over HTTP as cashier (SR-001 / SR-002) — creates nothing if fixed
	code, body, _ = ca.call(
		"ury.ury.api.minimal.business_setup.create_setup_user",
		email="qa_http_escalation@example.com",
		name="QA HTTP",
		password="QA-Http-2026!",
		role="System Manager",
	)
	record(
		"12.10 cashier cannot create System Manager (HTTP)",
		code == 403,
		{
			"code": code,
			"body": str(body)[:160],
			"cleanup": "delete user qa_http_escalation@example.com if created",
		},
	)

	write_evidence("cat12_security_probe.json", RESULTS)
	sys.exit(0 if all(r["pass"] in (True, None) for r in RESULTS) else 1)


if __name__ == "__main__":
	main()
