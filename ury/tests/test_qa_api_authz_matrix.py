# Copyright (c) 2026, Smart Choice and contributors
# For license information, please see license.txt
"""QA Cat. 4 + 5: API authorization and the role x DocType matrix.

Three layers:

1. Guest sweep — every non-guest whitelisted method in the app, called as
   Guest through Frappe's real dispatcher (`frappe.handler.execute_cmd`), must
   raise PermissionError *before* the function body runs. The method list is
   produced by qa/tools/endpoint_inventory.py at test time, so new endpoints
   are covered automatically.

2. Sensitive endpoints — called directly as each role and as a user with no
   restaurant role; must raise PermissionError where marked.

3. Role x DocType matrix — `frappe.has_permission` per role user per ptype,
   written to qa/evidence/role_matrix_observed.csv for review, with hard
   asserts only on the invariants listed in INVARIANTS.

Plus branch isolation: a branch-A cashier must not read or change branch-B
orders through any path tested here.
"""

import csv
import importlib.util
import os

import frappe
from frappe.utils import get_bench_path

from ury.tests.qa_base import QATestCase, RestaurantWorld, make_user

APP_ROOT = os.path.join(get_bench_path(), "apps", "ury")


def _inventory():
	path = os.path.join(APP_ROOT, "qa", "tools", "endpoint_inventory.py")
	spec = importlib.util.spec_from_file_location("endpoint_inventory", path)
	mod = importlib.util.module_from_spec(spec)
	spec.loader.exec_module(mod)
	return mod.inventory()


class TestQAGuestSweep(QATestCase):
	def test_every_non_guest_method_rejects_guest(self):
		from frappe.handler import execute_cmd

		failures = []
		rows = [r for r in _inventory() if r["guest"] == "no" and r["is_doc_method"] == "no"]
		self.assertGreater(len(rows), 200, "inventory looks wrong")
		for r in rows:
			frappe.set_user("Guest")
			frappe.local.form_dict = frappe._dict(cmd=r["method"])
			try:
				execute_cmd(r["method"])
				failures.append(f"{r['method']}: executed for Guest")
			except frappe.PermissionError:
				pass
			except Exception as e:  # any other error means the body ran
				failures.append(f"{r['method']}: body ran for Guest ({type(e).__name__})")
			finally:
				frappe.set_user("Administrator")
				frappe.db.rollback()
		self.assertEqual(failures, [], "\n".join(failures))


# (dotted path, kwargs, roles that MUST be refused)
REFUSE_ALL_STAFF = ("cashier", "captain", "outsider")
REFUSE_NON_MANAGER = ("cashier", "captain", "outsider")
REFUSE_NON_BILLING = ("captain", "outsider")

SENSITIVE = [
	("ury.ury.api.ury_dashboard.get_dashboard_stats", {"branch": "{B}"}, ("captain", "outsider")),
	("ury.ury.api.ury_dashboard.get_shift_metrics", {"branch": "{B}"}, ("captain", "outsider")),
	("ury.ury.api.ury_dashboard.get_needs_attention", {"branch": "{B}"}, ("captain", "outsider")),
	("ury.ury.api.ury_dashboard.get_floor_load", {"branch": "{B}"}, ("captain", "outsider")),
	("ury.ury.api.ury_dashboard.get_baseline", {"branch": "{B}"}, ("captain", "outsider")),
	("ury.ury.api.ury_service_line.get_service_line", {"branch": "{B}"}, ("outsider",)),
	("ury.ury.api.ury_service_line.get_running_low", {"branch": "{B}"}, ("outsider",)),
	(
		"ury.ury.report_api.sales.get_daywise_sales",
		{"start_date": "2026-01-01", "end_date": "2026-01-02"},
		REFUSE_NON_MANAGER,
	),
	("ury.ury.api.ury_kitchen_message.send_message", {"message": "qa", "branch": "{B}"}, ("outsider",)),
	("ury.ury.api.ury_kitchen_message.get_active_messages", {"branch": "{B}"}, ("outsider",)),
	(
		"ury.ury.doctype.ury_order.ury_order.merge_tables_batch",
		{"anchor_table": "{BT1}", "tables": '["{BT2}"]'},
		("outsider",),
	),
	("ury.ury.doctype.ury_order.ury_order.unmerge_tables", {"table": "{BT1}"}, ("outsider",)),
	(
		"ury.ury.api.ury_print.network_printing",
		{"doctype": "User", "name": "Administrator", "printer_setting": "x", "print_format": "Standard"},
		REFUSE_ALL_STAFF,
	),
]


class TestQASensitiveEndpoints(QATestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.a = RestaurantWorld.build("A")
		cls.b = RestaurantWorld.build("B")
		cls.users = {
			"cashier": cls.a.users["cashier"],
			"captain": cls.a.users["captain"],
			"outsider": make_user("qa_outsider@example.com", ["Blogger"]).name,
		}

	def _fmt(self, kwargs):
		subs = {"{B}": self.b.branch_name, "{BT1}": self.b.tables[2], "{BT2}": self.b.tables[3]}
		out = {}
		for k, v in kwargs.items():
			for key, val in subs.items():
				v = v.replace(key, val) if isinstance(v, str) else v
			out[k] = v
		return out

	def test_sensitive_endpoints_refuse_unauthorized_roles(self):
		failures = []
		for method, kwargs, refuse in SENSITIVE:
			try:
				fn = frappe.get_attr(method)
			except (AttributeError, ImportError):
				failures.append(f"{method}: not found (update this list)")
				continue
			for role in refuse:
				frappe.set_user(self.users[role])
				try:
					fn(**self._fmt(kwargs))
					failures.append(f"{method} as {role}: allowed")
				except frappe.PermissionError:
					pass
				except Exception as e:
					failures.append(
						f"{method} as {role}: {type(e).__name__} instead of PermissionError: {str(e)[:80]}"
					)
				finally:
					frappe.set_user("Administrator")
					frappe.db.rollback()
		self.assertEqual(failures, [], "\n".join(failures))


class TestQABranchIsolation(QATestCase):
	"""A cashier of branch A must not see or modify branch B orders."""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.a = RestaurantWorld.build("A")
		cls.b = RestaurantWorld.build("B")
		cls.b_table = cls.b.free_table()
		cls.b_inv = cls.b.order(cls.b_table, [("_QA Burger", 1)])["name"]
		frappe.db.commit()

	def _as_a_cashier(self, fn, *args, **kwargs):
		frappe.set_user(self.a.users["cashier"])
		try:
			return fn(*args, **kwargs)
		finally:
			frappe.set_user("Administrator")

	def test_get_order_invoice_other_branch(self):
		from ury.ury.doctype.ury_order.ury_order import get_order_invoice

		with self.assertRaises(frappe.PermissionError):
			self._as_a_cashier(get_order_invoice, invoiceNo=self.b_inv)

	def test_sync_order_on_other_branch_table(self):
		with self.assertRaises(frappe.PermissionError):
			self.a.order(self.b_table, [("_QA Tea", 1)], invoice=self.b_inv)

	def test_make_invoice_other_branch(self):
		with self.assertRaises(frappe.PermissionError):
			self.a.pay(self.b_inv, [(self.a.cash, 12000)])

	def test_cancel_order_other_branch(self):
		from ury.ury.doctype.ury_order.ury_order import cancel_order

		with self.assertRaises(frappe.PermissionError):
			self._as_a_cashier(cancel_order, self.b_inv, "qa")

	def test_generic_list_api_hides_other_branch(self):
		# Frappe's own list/read API (what /api/resource and frappe.client use).
		rows = self._as_a_cashier(
			frappe.get_list, "POS Invoice", filters={"branch": self.b.branch_name}, pluck="name"
		)
		self.assertEqual(rows, [], "branch-A cashier can list branch-B invoices via /api/resource")

	def test_generic_get_doc_hides_other_branch(self):
		from frappe.client import get as client_get

		with self.assertRaises(frappe.PermissionError):
			self._as_a_cashier(client_get, "POS Invoice", self.b_inv)


# Hard invariants on the role matrix. Everything else is recorded, not asserted.
INVARIANTS = [
	("captain", "POS Invoice", "cancel", False),
	("captain", "Sub POS Closing", "submit", False),
	("captain", "URY Menu", "write", False),
	("cashier", "URY Audit Log", "write", False),
	("cashier", "URY Audit Log", "delete", False),
	("captain", "URY Audit Log", "read", False),
	("outsider", "POS Invoice", "read", False),
	("outsider", "URY KOT", "read", False),
	("outsider", "User", "create", False),
]
MATRIX_DOCTYPES = [
	"POS Invoice",
	"POS Opening Entry",
	"POS Closing Entry",
	"Sub POS Closing",
	"URY KOT",
	"URY Table",
	"URY Menu",
	"URY Restaurant",
	"URY Room",
	"URY Production Unit",
	"URY Audit Log",
	"URY Delivery",
	"URY Driver",
	"URY Self Ordering Profile",
	"URY Ordering Device",
	"URY Payment Terminal",
	"URY Daily P and L",
	"URY Waste Log",
	"Item Price",
	"Price List",
	"Customer",
	"User",
]
PTYPES = ["read", "write", "create", "delete", "submit", "cancel"]


class TestQARoleMatrix(QATestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		w = RestaurantWorld.build("A")
		cls.users = {
			**{k: v for k, v in w.users.items()},
			"outsider": make_user("qa_outsider@example.com", ["Blogger"]).name,
		}

	def test_matrix(self):
		out = os.path.join(APP_ROOT, "qa", "evidence", "role_matrix_observed.csv")
		os.makedirs(os.path.dirname(out), exist_ok=True)
		observed = {}
		with open(out, "w", newline="") as fh:
			writer = csv.writer(fh)
			writer.writerow(["role", "doctype", *PTYPES])
			for role, user in self.users.items():
				for dt in MATRIX_DOCTYPES:
					if not frappe.db.exists("DocType", dt):
						continue
					row = []
					for p in PTYPES:
						allowed = bool(frappe.has_permission(dt, p, user=user))
						observed[(role, dt, p)] = allowed
						row.append(int(allowed))
					writer.writerow([role, dt, *row])
		broken = [
			f"{r} {dt} {p}: expected {exp}, got {observed.get((r, dt, p))}"
			for r, dt, p, exp in INVARIANTS
			if observed.get((r, dt, p)) != exp
		]
		self.assertEqual(broken, [], "\n".join(broken))

	def test_cashier_menu_and_restaurant_write_is_a_decision(self):
		# NEEDS DECISION: URY Menu and URY Restaurant grant URY Cashier "write".
		# A cashier can then change menu rates (republished to the price list on
		# save) and the restaurant's tax template. Recorded, not asserted.
		for dt in ("URY Menu", "URY Restaurant"):
			allowed = frappe.has_permission(dt, "write", user=self.users["cashier"])
			print(f"[NEEDS DECISION] cashier write on {dt}: {allowed}")
