# Copyright (c) 2026, Smart Choice and contributors
# For license information, please see license.txt
"""Seeding and integrity checks for the QA scripts under qa/ (QA site only).

    bench --site qa1.localhost execute ury.tests.qa_seed.seed_worlds --kwargs "{'suffixes': 'A,B'}"
    bench --site qa1.localhost execute ury.tests.qa_seed.seed_load
    bench --site qa1.localhost execute ury.tests.qa_seed.integrity_report --kwargs "{'since': '2026-10-05 09:00:00'}"

Every entry point calls assert_qa_site() first.
"""

import json
import random

import frappe
from frappe.utils import add_days, flt, now_datetime, today

from ury.tests.qa_base import QA_PASSWORD, RestaurantWorld, assert_qa_site, make_user


def _guard():
	try:
		assert_qa_site()
	except Exception as e:  # SkipTest is not meaningful outside unittest
		raise RuntimeError(str(e)) from None


def seed_worlds(suffixes="A,B"):
	"""Create the per-branch restaurant worlds used by the HTTP scripts."""
	_guard()
	out = {}
	for s in [x.strip() for x in suffixes.split(",") if x.strip()]:
		w = RestaurantWorld.build(s)
		out[s] = {
			"branch": w.branch_name,
			"profile": w.profile_name,
			"restaurant": w.restaurant_name,
			"room": w.room_name,
			"tables": w.tables,
			"production": w.production_name,
			"users": w.users,
			"password": QA_PASSWORD,
			"cash": w.cash,
			"card": w.card,
			"customer": w.customer,
			"opening_entry": w.opening_entry,
		}
	frappe.db.commit()
	print(json.dumps(out, indent=1, default=str))
	return out


def seed_load(branches=3, menu_items=500, pos_users=40, historical_orders=100_000, seed=20261004):
	"""Load-test data: N branches, a 500-item menu, 40 POS users, 100k past orders.

	Historical orders are bulk-inserted as submitted, consolidated POS
	Invoices with one item each, spread over the last 365 days. They exist
	to give the report/list queries realistic table sizes and index
	pressure; they carry no GL or stock postings by design.
	"""
	_guard()
	rng = random.Random(seed)
	worlds = [RestaurantWorld.build(f"L{i + 1}") for i in range(int(branches))]

	# Menu items
	codes = []
	for i in range(int(menu_items)):
		code = f"_QA Load Item {i:03d}"
		codes.append(code)
		if not frappe.db.exists("Item", code):
			frappe.get_doc(
				{
					"doctype": "Item",
					"item_code": code,
					"item_name": f"صنف تجريبي رقم {i:03d} مع اسم عربي طويل",
					"item_group": worlds[0].item_group,
					"stock_uom": worlds[0].uom,
					"is_stock_item": 0,
				}
			).insert(ignore_permissions=True)
	for w in worlds:
		menu = frappe.get_doc("URY Menu", w.menu_name)
		have = {r.item for r in menu.items}
		for code in codes:
			if code not in have:
				menu.append(
					"items",
					{"item": code, "item_name": code, "rate": rng.choice([1000, 2500, 4750, 7000, 12000])},
				)
		menu.save(ignore_permissions=True)

	# POS users spread over branches, each with own tables
	users = []
	per_branch = -(-int(pos_users) // len(worlds))
	for bi, w in enumerate(worlds):
		branch = frappe.get_doc("Branch", w.branch_name)
		mapped = {r.user for r in branch.user}
		for k in range(per_branch):
			email = f"qa_load_{bi + 1}_{k:02d}@example.com"
			make_user(email, ["URY Cashier"])
			if email not in mapped:
				branch.append("user", {"user": email, "room": w.room_name})
			for t in (1, 2):
				name = f"_QA {w.suffix} LT{k:02d}-{t}"
				if not frappe.db.exists("URY Table", name):
					doc = frappe.get_doc(
						{
							"doctype": "URY Table",
							"restaurant": w.restaurant_name,
							"restaurant_room": w.room_name,
							"branch": w.branch_name,
						}
					)
					doc.name = name
					doc.flags.name_set = True
					doc.insert(ignore_permissions=True)
			users.append(
				{
					"user": email,
					"branch": w.suffix,
					"tables": [f"_QA {w.suffix} LT{k:02d}-{t}" for t in (1, 2)],
				}
			)
		branch.save(ignore_permissions=True)
	frappe.db.commit()

	_bulk_history(worlds, codes, int(historical_orders), rng)

	manifest = {
		"password": QA_PASSWORD,
		"users": users,
		"worlds": {
			w.suffix: {"profile": w.profile_name, "cash": w.cash, "customer": w.customer, "room": w.room_name}
			for w in worlds
		},
		"items": codes[:50],
	}
	print(json.dumps(manifest, default=str))
	return manifest


def _bulk_history(worlds, codes, count, rng):
	existing = frappe.db.count("POS Invoice", {"name": ["like", "QA-HIST-%"]})
	if existing >= count:
		return
	inv_fields = [
		"name",
		"creation",
		"modified",
		"owner",
		"modified_by",
		"docstatus",
		"naming_series",
		"company",
		"customer",
		"customer_name",
		"posting_date",
		"posting_time",
		"currency",
		"conversion_rate",
		"selling_price_list",
		"price_list_currency",
		"plc_conversion_rate",
		"is_pos",
		"pos_profile",
		"branch",
		"restaurant",
		"status",
		"total_qty",
		"base_total",
		"total",
		"net_total",
		"base_net_total",
		"grand_total",
		"base_grand_total",
		"rounded_total",
		"base_rounded_total",
		"paid_amount",
		"base_paid_amount",
		"order_type",
		"waiter",
		"invoice_printed",
	]
	item_fields = [
		"name",
		"creation",
		"modified",
		"owner",
		"modified_by",
		"docstatus",
		"parent",
		"parentfield",
		"parenttype",
		"idx",
		"item_code",
		"item_name",
		"qty",
		"stock_qty",
		"uom",
		"stock_uom",
		"conversion_factor",
		"rate",
		"base_rate",
		"amount",
		"base_amount",
		"net_rate",
		"net_amount",
		"price_list_rate",
		"income_account",
		"cost_center",
	]
	income = frappe.db.get_value(
		"Account", {"company": worlds[0].company, "account_type": "Income Account", "is_group": 0}
	)
	batch_inv, batch_item = [], []
	for n in range(existing, count):
		w = worlds[n % len(worlds)]
		code = rng.choice(codes)
		rate = rng.choice([1000, 2500, 4750, 7000, 12000])
		qty = rng.randint(1, 4)
		total = rate * qty
		day = add_days(today(), -rng.randint(1, 365))
		ts = f"{day} {rng.randint(10, 23):02d}:{rng.randint(0, 59):02d}:00"
		name = f"QA-HIST-{n:07d}"
		batch_inv.append(
			(
				name,
				ts,
				ts,
				"Administrator",
				"Administrator",
				1,
				"QA-HIST-",
				w.company,
				w.customer,
				w.customer,
				day,
				ts[11:],
				w.currency,
				1,
				w.price_list,
				w.currency,
				1,
				1,
				w.profile_name,
				w.branch_name,
				w.restaurant_name,
				"Consolidated",
				qty,
				total,
				total,
				total,
				total,
				total,
				total,
				total,
				total,
				total,
				total,
				rng.choice(["Dine In", "Take Away", "Delivery"]),
				w.users["cashier"],
				1,
			)
		)
		batch_item.append(
			(
				f"QA-HIST-I-{n:07d}",
				ts,
				ts,
				"Administrator",
				"Administrator",
				1,
				name,
				"items",
				"POS Invoice",
				1,
				code,
				code,
				qty,
				qty,
				w.uom,
				w.uom,
				1,
				rate,
				rate,
				total,
				total,
				rate,
				total,
				rate,
				income,
				w.profile.cost_center,
			)
		)
		if len(batch_inv) == 2000:
			frappe.db.bulk_insert("POS Invoice", inv_fields, batch_inv, ignore_duplicates=True)
			frappe.db.bulk_insert("POS Invoice Item", item_fields, batch_item, ignore_duplicates=True)
			frappe.db.commit()
			batch_inv, batch_item = [], []
	if batch_inv:
		frappe.db.bulk_insert("POS Invoice", inv_fields, batch_inv, ignore_duplicates=True)
		frappe.db.bulk_insert("POS Invoice Item", item_fields, batch_item, ignore_duplicates=True)
		frappe.db.commit()


def integrity_report(since=None):
	"""Post-run data integrity checks. Prints JSON; every list should be empty."""
	_guard()
	since = since or str(add_days(now_datetime(), -1))
	q = lambda sql, *a: frappe.db.sql(sql, a, as_dict=True)  # noqa: E731

	report = {
		"since": since,
		# paid amount minus change must equal the (rounded) total
		"payment_mismatch": q(
			"""SELECT pi.name, pi.grand_total, pi.rounded_total, pi.paid_amount, pi.change_amount,
				(SELECT SUM(amount) FROM `tabSales Invoice Payment` p WHERE p.parent = pi.name AND p.parenttype='POS Invoice') AS tendered
			FROM `tabPOS Invoice` pi
			WHERE pi.docstatus = 1 AND pi.modified >= %s AND pi.name NOT LIKE 'QA-HIST-%%'
			HAVING ABS(IFNULL(tendered,0) - IFNULL(pi.change_amount,0) - IF(IFNULL(pi.rounded_total,0)=0, pi.grand_total, pi.rounded_total)) > 0.5""",
			since,
		),
		# more than one submitted settlement on one invoice name is impossible; duplicate payment rows are not
		"duplicate_payment_rows": q(
			"""SELECT parent, mode_of_payment, COUNT(*) n FROM `tabSales Invoice Payment`
			WHERE parenttype='POS Invoice' AND modified >= %s AND amount > 0
			GROUP BY parent, mode_of_payment HAVING n > 1""",
			since,
		),
		"invoices_without_kot": q(
			"""SELECT pi.name FROM `tabPOS Invoice` pi
			WHERE pi.creation >= %s AND pi.creation < NOW() - INTERVAL 3 MINUTE AND pi.docstatus < 2
				AND pi.name NOT LIKE 'QA-HIST-%%' AND IFNULL(pi.order_type,'') != 'Aggregators'
				AND NOT EXISTS (SELECT 1 FROM `tabURY KOT` k WHERE k.invoice = pi.name)""",
			since,
		),
		"duplicate_order_numbers": q(
			"""SELECT pos_profile, posting_date, custom_ury_order_number, COUNT(*) n, GROUP_CONCAT(name) names
			FROM `tabPOS Invoice` WHERE creation >= %s AND IFNULL(custom_ury_order_number,'') != ''
			GROUP BY pos_profile, posting_date, custom_ury_order_number HAVING n > 1""",
			since,
		),
		"occupied_tables_without_open_bill": q(
			"""SELECT t.name FROM `tabURY Table` t WHERE t.occupied = 1 AND t.name LIKE '\\_QA%%'
			AND NOT EXISTS (SELECT 1 FROM `tabPOS Invoice` pi WHERE pi.docstatus = 0
				AND (pi.restaurant_table = t.name OR FIND_IN_SET(t.name, REPLACE(pi.custom_merged_tables, ', ', ','))))"""
		),
		"open_bill_on_free_table": q(
			"""SELECT pi.name, pi.restaurant_table FROM `tabPOS Invoice` pi
			INNER JOIN `tabURY Table` t ON t.name = pi.restaurant_table
			WHERE pi.docstatus = 0 AND t.occupied = 0 AND pi.creation >= %s""",
			since,
		),
		"paid_but_shift_closed_unconsolidated": q(
			"""SELECT pi.name, pi.pos_profile FROM `tabPOS Invoice` pi
			WHERE pi.docstatus = 1 AND pi.status = 'Paid' AND pi.modified >= %s AND pi.name NOT LIKE 'QA-HIST-%%'
				AND NOT EXISTS (SELECT 1 FROM `tabPOS Opening Entry` o WHERE o.pos_profile = pi.pos_profile
					AND o.status = 'Open' AND o.docstatus = 1)""",
			since,
		),
		"error_log_by_title": q(
			"""SELECT method AS title, COUNT(*) n FROM `tabError Log` WHERE creation >= %s
			GROUP BY method ORDER BY n DESC LIMIT 30""",
			since,
		),
	}
	report["ok"] = all(not v for k, v in report.items() if k not in ("since", "error_log_by_title", "ok"))
	print(json.dumps(report, indent=1, default=str))
	return report


def fixtures_report(expect="present"):
	"""Compare the app's shipped fixtures with the site. `expect`: present | absent (after uninstall)."""
	_guard()
	import os

	fixtures_dir = frappe.get_app_path("ury", "fixtures")
	out = {"expect": expect, "missing": [], "unexpected": [], "checked": 0}
	for fname, doctype in (
		("custom_field.json", "Custom Field"),
		("property_setter.json", "Property Setter"),
		("role.json", "Role"),
		("client_script.json", "Client Script"),
	):
		path = os.path.join(fixtures_dir, fname)
		if not os.path.exists(path):
			continue
		with open(path) as fh:
			names = [d["name"] for d in json.load(fh)]
		for name in names:
			out["checked"] += 1
			exists = bool(frappe.db.exists(doctype, name))
			if expect == "present" and not exists:
				out["missing"].append(f"{doctype}: {name}")
			if expect == "absent" and exists and doctype != "Role":
				out["unexpected"].append(f"{doctype}: {name}")
	out["ok"] = not out["missing"] and not out["unexpected"]
	print(json.dumps(out, indent=1))
	return out


def counts_snapshot():
	"""Row counts used to compare a site before backup and after restore."""
	_guard()
	dts = [
		"POS Invoice",
		"POS Invoice Item",
		"Sales Invoice Payment",
		"URY KOT",
		"URY KOT Items",
		"URY Table",
		"URY Menu Item",
		"POS Opening Entry",
		"POS Closing Entry",
		"Sub POS Closing",
		"GL Entry",
		"File",
		"User",
	]
	out = {dt: frappe.db.count(dt) for dt in dts}
	out["pos_invoice_grand_total_sum"] = flt(
		frappe.db.sql("SELECT SUM(grand_total) FROM `tabPOS Invoice` WHERE docstatus=1")[0][0], 2
	)
	print(json.dumps(out, default=str))
	return out
