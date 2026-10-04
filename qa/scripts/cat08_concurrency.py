#!/usr/bin/env python3
"""QA Cat. 8 — concurrency & data integrity, reproduced over real HTTP.

Scenarios (each prints PASS/FAIL with evidence; all evidence also lands in
qa/evidence/cat08_concurrency.json):

  8.1  Same table, two cashiers, simultaneous sync_order        -> no lost update
  8.2  Double-click / retry on payment (N parallel make_invoice) -> exactly one settlement
  8.3  Parallel order creation across tables                     -> unique names + order numbers
  8.4  sync_order retry with the same request_id in parallel     -> one invoice change, one KOT
  8.5  Close shift while a payment is in flight                  -> no orphaned paid invoice
  8.6  Two cashiers settle the same table bill by table path     -> one settlement

Prereqs on the QA server:
  bench --site qa1.localhost execute ury.tests.qa_seed.seed_worlds --kwargs "{'suffixes':'A,B'}" > qa/evidence/world_qa1.localhost.json
  ~/qa-tools/venv/bin/python qa/scripts/cat08_concurrency.py
Then:
  bench --site qa1.localhost execute ury.tests.qa_seed.integrity_report --kwargs "{'since': '<start time printed below>'}"
"""

import concurrent.futures as cf
import datetime
import sys
import uuid

from qa_env import SITE_1, URL_1, FrappeClient, guard, load_world, make_invoice, sync_order, write_evidence

RESULTS = []


def record(sid, passed, detail):
	RESULTS.append({"scenario": sid, "pass": passed, "detail": detail})
	print(f"[{'PASS' if passed else 'FAIL'}] {sid}: {str(detail)[:300]}")


def cashier(world, role="cashier"):
	return FrappeClient(URL_1, SITE_1).login(world["users"][role], world["password"])


def parallel(n, fn):
	with cf.ThreadPoolExecutor(max_workers=n) as ex:
		return list(ex.map(lambda i: fn(i), range(n)))


def items_of(client, invoice):
	_code, doc = client.get_doc("POS Invoice", invoice)
	data = doc.get("data", {}) if isinstance(doc, dict) else {}
	return data, {(r["item_code"], float(r["qty"])) for r in data.get("items", [])}


def s1_same_table_two_cashiers(w):
	c1, c2 = cashier(w), cashier(w, "manager")
	table = w["tables"][0]
	_code, body, _ = sync_order(c1, w, table, [("_QA Burger", 1)])
	inv = body["message"]["name"]
	modified = body["message"]["modified"]

	def edit(i):
		c = (c1, c2)[i]
		extra = ("_QA Tea", 2) if i == 0 else ("_QA Shawarma", 1)
		return c.call(
			"ury.ury.doctype.ury_order.ury_order.sync_order",
			items=[
				{"item": "_QA Burger", "item_name": "_QA Burger", "qty": 1, "comment": ""},
				{"item": extra[0], "item_name": extra[0], "qty": extra[1], "comment": ""},
			],
			cashier=w["users"]["cashier"],
			owner=c.user,
			mode_of_payment=w["cash"],
			customer=w["customer"],
			no_of_pax=2,
			last_invoice=inv,
			last_modified_time=modified,
			waiter=c.user,
			pos_profile=w["profile"],
			table=table,
			invoice=inv,
			room=w["room"],
		)

	res = parallel(2, edit)
	ok = [r for r in res if r[0] == 200 and isinstance(r[1], dict) and isinstance(r[1].get("message"), dict)]
	_, final = items_of(c1, inv)
	# Pass if exactly one edit won and the other was told to reload, OR both applied (no lost update).
	lost = len(ok) == 2 and not ({("_QA Tea", 2.0), ("_QA Shawarma", 1.0)} <= final)
	record(
		"8.1 same-table concurrent edit",
		not lost,
		{"responses": [(r[0], str(r[1])[:120]) for r in res], "final_items": sorted(final)},
	)


def s2_double_pay(w, n=5):
	c = cashier(w)
	table = w["tables"][1]
	_, body, _ = sync_order(c, w, table, [("_QA Burger", 2)])
	inv = body["message"]["name"]
	res = parallel(n, lambda i: make_invoice(c, w, inv, [(w["cash"], 24000)], table=table))
	data, _ = items_of(c, inv)
	pays = [p for p in data.get("payments", []) if float(p.get("amount") or 0) > 0]
	total_paid = sum(float(p["amount"]) for p in pays)
	passed = data.get("docstatus") == 1 and abs(total_paid - 24000) < 0.5
	record(
		"8.2 double-click payment",
		passed,
		{"codes": [r[0] for r in res], "payments": pays, "docstatus": data.get("docstatus")},
	)


def s3_parallel_orders(w, n=None):
	tables = [*w["tables"][2:], w["tables"][0]]
	n = n or len(tables)
	clients = [cashier(w) for _ in range(n)]
	res = parallel(n, lambda i: sync_order(clients[i], w, tables[i % len(tables)], [("_QA Tea", 1)]))
	names = [r[1]["message"]["name"] for r in res if r[0] == 200 and isinstance(r[1].get("message"), dict)]
	numbers = []
	for name in names:
		d, _ = items_of(clients[0], name)
		numbers.append(d.get("custom_ury_order_number"))
	passed = len(names) == len(set(names)) and len([x for x in numbers if x]) == len(
		set(x for x in numbers if x)
	)
	record(
		"8.3 parallel order numbering",
		passed,
		{"names": names, "order_numbers": numbers, "errors": [str(r[1])[:120] for r in res if r[0] != 200]},
	)


def s4_same_request_id(w):
	c = cashier(w)
	table = w["tables"][3]
	rid = str(uuid.uuid4())
	res = parallel(4, lambda i: sync_order(c, w, table, [("_QA Burger", 1)], request_id=rid))
	names = {r[1]["message"]["name"] for r in res if r[0] == 200 and isinstance(r[1].get("message"), dict)}
	kots = []
	for name in names:
		_code, body, _ = c.call(
			"frappe.client.get_list",
			doctype="URY KOT",
			filters={"invoice": name},
			fields=["name"],
			limit_page_length=50,
		)
		kots += body.get("message", []) if isinstance(body, dict) else []
	record(
		"8.4 idempotent retry (request_id)",
		len(names) == 1 and len(kots) == 1,
		{"invoices": sorted(names), "kots": kots},
	)


def s5_close_shift_during_payment(w):
	c, mgr = cashier(w), cashier(w, "manager")
	table = w["tables"][0]
	_, body, _ = sync_order(c, w, table, [("_QA Tea", 2)])
	inv = body["message"]["name"]

	def pay(_):
		return make_invoice(c, w, inv, [(w["cash"], 3000)], table=table)

	def close(_):
		code, body, _ = mgr.call(
			"erpnext.accounts.doctype.pos_closing_entry.pos_closing_entry.make_closing_entry_from_opening",
			opening_entry=w["opening_entry"],
		)
		return code, body

	with cf.ThreadPoolExecutor(max_workers=2) as ex:
		f1, f2 = ex.submit(pay, 0), ex.submit(close, 0)
		r1, r2 = f1.result(), f2.result()
	record(
		"8.5 close shift during payment (inspect)",
		r1[0] == 200,
		{
			"pay": (r1[0], str(r1[1])[:160]),
			"closing_draft": (r2[0], str(r2[1])[:160]),
			"note": "Submit of the closing is done manually; then run integrity_report -> paid_but_shift_closed_unconsolidated must be empty",
		},
	)


def s6_table_path_double_settle(w):
	c1, c2 = cashier(w), cashier(w, "manager")
	table = w["tables"][1]
	_, body, _ = sync_order(c1, w, table, [("_QA Shawarma", 2)])
	inv = body["message"]["name"]
	res = parallel(2, lambda i: make_invoice((c1, c2)[i], w, None, [(w["cash"], 9500)], table=table))
	data, _ = items_of(c1, inv)
	pays = [p for p in data.get("payments", []) if float(p.get("amount") or 0) > 0]
	passed = abs(sum(float(p["amount"]) for p in pays) - 9500) < 0.5
	record(
		"8.6 table-path double settle",
		passed,
		{"codes": [r[0] for r in res], "bodies": [str(r[1])[:120] for r in res], "payments": pays},
	)


def main():
	guard(URL_1)
	start = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
	print(f"start={start}")
	w = load_world(SITE_1)["A"]
	for fn in (
		s1_same_table_two_cashiers,
		s2_double_pay,
		s3_parallel_orders,
		s4_same_request_id,
		s6_table_path_double_settle,
		s5_close_shift_during_payment,
	):
		try:
			fn(w)
		except Exception as e:  # a crash is a result, not a reason to stop
			record(fn.__name__, False, f"script error: {e!r}")
	write_evidence("cat08_concurrency.json", {"start": start, "results": RESULTS})
	sys.exit(0 if all(r["pass"] for r in RESULTS) else 1)


if __name__ == "__main__":
	main()
