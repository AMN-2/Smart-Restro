# Copyright (c) 2026, Smart Choice and contributors
# For license information, please see license.txt
"""Shared base for the pre-production QA suite (qa/pre-prod-2026-10-04).

Two things live here:

1. A site guard. These tests create users, branches, invoices and payments
   and some of them commit (the app under test calls frappe.db.commit() in
   several hooks). They must never run against a real site, so every QA test
   class refuses to start unless the current site is on an explicit allow-list
   and is not on a deny-list of known production sites. The allow-list can be
   extended with the QA_ALLOWED_SITES environment variable on the QA server;
   the deny-list cannot be overridden.

2. A fixture builder, `RestaurantWorld`, that creates one complete restaurant
   for one branch (room, tables, restaurant, menu + price list, POS Profile,
   one user per role, an open POS Opening Entry). Everything is named with a
   `_QA` prefix and a branch suffix so two worlds (branch A / branch B) can
   coexist for isolation tests. Creation is get-or-create, so a rerun on the
   same QA site reuses what is already there.

None of this has been executed yet: it was written on the production server,
where running it is forbidden. The first run on the QA server is a fixture
shakedown; a failure in setUp is a test problem until proven otherwise
(Hard Rule 3).
"""

import os
import unittest
from typing import ClassVar

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, get_datetime

QA_ALLOWED_SITES = {"qa1.localhost", "qa2.localhost"} | {
	s.strip() for s in os.environ.get("QA_ALLOWED_SITES", "").split(",") if s.strip()
}
# Known production / shared sites. Never overridable.
QA_DENIED_SITES = {
	"portal.smartchoice-iq.com",
	"demo.smarterp.com",
	"demo.smart_chat.com",
}

QA_PASSWORD = "QA-Only-Pass-2026!"  # disposable QA site only


def assert_qa_site():
	"""Error on a known production site; skip on any other non-QA site."""
	site = getattr(frappe.local, "site", None)
	if site in QA_DENIED_SITES:
		raise RuntimeError(f"QA suite refused to run on production site {site!r}.")
	if site not in QA_ALLOWED_SITES:
		raise unittest.SkipTest(
			f"QA suite only runs on {sorted(QA_ALLOWED_SITES)} (set QA_ALLOWED_SITES to extend); "
			f"current site {site!r}."
		)


class QATestCase(FrappeTestCase):
	"""FrappeTestCase that refuses to run outside a QA site."""

	@classmethod
	def setUpClass(cls):
		assert_qa_site()
		super().setUpClass()

	def setUp(self):
		frappe.set_user("Administrator")

	def tearDown(self):
		frappe.set_user("Administrator")


# ---------------------------------------------------------------------------
# Site lookups
# ---------------------------------------------------------------------------


def resolve_company():
	company = frappe.defaults.get_defaults().get("company")
	if company and frappe.db.exists("Company", company):
		return company
	companies = frappe.get_all("Company", pluck="name", limit=1)
	return companies[0] if companies else None


def payment_modes_for(company, limit=2):
	"""Enabled Modes of Payment that have an account for `company`, cash first."""
	rows = frappe.db.sql(
		"""
		SELECT mop.name, mop.type
		FROM `tabMode of Payment` mop
		INNER JOIN `tabMode of Payment Account` acc
			ON acc.parent = mop.name AND acc.company = %s AND IFNULL(acc.default_account, '') != ''
		WHERE mop.enabled = 1
		ORDER BY (mop.type = 'Cash') DESC, mop.name
		""",
		company,
		as_dict=True,
	)
	return [r.name for r in rows][:limit]


def leaf(doctype, filters=None):
	f = {"is_group": 0}
	f.update(filters or {})
	return frappe.db.get_value(doctype, f, "name")


def get_or_create(doctype, name, values, name_field=None):
	"""Insert a document named `name` unless it already exists."""
	if frappe.db.exists(doctype, name):
		return frappe.get_doc(doctype, name)
	doc = frappe.get_doc({"doctype": doctype, **values})
	if name_field:
		doc.set(name_field, name)
	else:
		doc.name = name
	doc.flags.name_set = True
	doc.insert(ignore_permissions=True)
	return doc


def make_user(email, roles, first_name=None):
	if frappe.db.exists("User", email):
		user = frappe.get_doc("User", email)
	else:
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": first_name or email.split("@")[0],
				"send_welcome_email": 0,
				"enabled": 1,
				"user_type": "System User" if roles else "Website User",
			}
		)
		user.insert(ignore_permissions=True)
		from frappe.utils.password import update_password

		update_password(email, QA_PASSWORD)
	missing = [r for r in roles if r not in frappe.get_roles(email)]
	if missing:
		user.add_roles(*missing)
	return user


# ---------------------------------------------------------------------------
# Restaurant world
# ---------------------------------------------------------------------------


class RestaurantWorld:
	"""One branch worth of restaurant data. Build with `RestaurantWorld.build("A")`."""

	ITEM_RATES: ClassVar[dict] = {"_QA Burger": 12000, "_QA Tea": 1500, "_QA Shawarma": 4750}

	def __init__(self, suffix):
		self.suffix = suffix
		self.company = resolve_company()
		if not self.company:
			raise frappe.ValidationError("No Company on this site")
		self.currency = frappe.db.get_value("Company", self.company, "default_currency")
		self.modes = payment_modes_for(self.company)
		if not self.modes:
			raise frappe.ValidationError(f"No Mode of Payment with an account for {self.company}")
		self.cash = self.modes[0]
		self.card = self.modes[1] if len(self.modes) > 1 else None

		s = suffix
		self.branch_name = f"_QA Branch {s}"
		self.room_name = f"_QA Room {s}"
		self.restaurant_name = f"_QA Restaurant {s}"
		self.menu_name = f"_QA Menu {s}"
		self.profile_name = f"_QA POS Profile {s}"
		self.tables = [f"_QA {s} T{i}" for i in (1, 2, 3, 4)]
		self.takeaway_table = f"_QA {s} TAKEAWAY"
		self.production_name = f"_QA Kitchen {s}"
		self.users = {
			"cashier": f"qa_cashier_{s.lower()}@example.com",
			"captain": f"qa_captain_{s.lower()}@example.com",
			"manager": f"qa_manager_{s.lower()}@example.com",
		}

	# -- build -------------------------------------------------------------

	@classmethod
	def build(cls, suffix="A"):
		assert_qa_site()
		frappe.set_user("Administrator")
		w = cls(suffix)
		w._users()
		w._items()
		w._branch()
		w._room_and_restaurant()
		w._menu()
		w._tables()
		w._profile()
		w._production_unit()
		w._opening_entry()
		frappe.db.commit()
		return w

	def _users(self):
		make_user(self.users["cashier"], ["URY Cashier"])
		make_user(self.users["captain"], ["URY Captain"])
		make_user(self.users["manager"], ["URY Manager"])

	def _items(self):
		self.item_group = leaf("Item Group")
		self.uom = frappe.db.get_value("UOM", "Nos") or leaf("UOM") or frappe.db.get_value("UOM", {})
		for code in self.ITEM_RATES:
			if not frappe.db.exists("Item", code):
				frappe.get_doc(
					{
						"doctype": "Item",
						"item_code": code,
						"item_name": code,
						"item_group": self.item_group,
						"stock_uom": self.uom,
						"is_stock_item": 0,
						"is_sales_item": 1,
						"include_item_in_manufacturing": 0,
					}
				).insert(ignore_permissions=True)
		self.customer_group = leaf("Customer Group") or "All Customer Groups"
		self.territory = leaf("Territory") or "All Territories"
		self.customer = "_QA Walk-in"
		if not frappe.db.exists("Customer", self.customer):
			frappe.get_doc(
				{
					"doctype": "Customer",
					"customer_name": self.customer,
					"customer_type": "Individual",
					"customer_group": self.customer_group,
					"territory": self.territory,
				}
			).insert(ignore_permissions=True)

	def _branch(self):
		rows = [{"user": u} for u in self.users.values()]
		if frappe.db.exists("Branch", self.branch_name):
			self.branch = frappe.get_doc("Branch", self.branch_name)
		else:
			self.branch = frappe.get_doc({"doctype": "Branch", "branch": self.branch_name, "user": rows})
			self.branch.insert(ignore_permissions=True)

	def _room_and_restaurant(self):
		get_or_create("URY Room", self.room_name, {"branch": self.branch_name})
		# Map every branch user to the room (getBranchRoom / getRoom need it).
		branch = frappe.get_doc("Branch", self.branch_name)
		for row in branch.user:
			row.room = self.room_name
		branch.save(ignore_permissions=True)
		get_or_create(
			"URY Restaurant",
			self.restaurant_name,
			{
				"company": self.company,
				"invoice_series_prefix": f"QA{self.suffix}INV",
				"branch": self.branch_name,
				"default_room": self.room_name,
			},
		)

	def _menu(self):
		if not frappe.db.exists("URY Menu", self.menu_name):
			menu = frappe.get_doc(
				{
					"doctype": "URY Menu",
					"enabled": 1,
					"branch": self.branch_name,
					"items": [
						{"item": code, "item_name": code, "rate": rate}
						for code, rate in self.ITEM_RATES.items()
					],
				}
			)
			menu.name = self.menu_name
			menu.flags.name_set = True
			menu.insert(ignore_permissions=True)
		self.price_list = frappe.db.get_value("URY Menu", self.menu_name, "price_list")
		frappe.db.set_value("URY Restaurant", self.restaurant_name, "active_menu", self.menu_name)

	def _tables(self):
		for t in self.tables:
			get_or_create(
				"URY Table",
				t,
				{
					"restaurant": self.restaurant_name,
					"restaurant_room": self.room_name,
					"branch": self.branch_name,
				},
			)
		get_or_create(
			"URY Table",
			self.takeaway_table,
			{
				"restaurant": self.restaurant_name,
				"restaurant_room": self.room_name,
				"branch": self.branch_name,
				"is_take_away": 1,
			},
		)

	def _profile(self):
		if frappe.db.exists("POS Profile", self.profile_name):
			self.profile = frappe.get_doc("POS Profile", self.profile_name)
			return
		cost_center = leaf("Cost Center", {"company": self.company})
		p = frappe.get_doc(
			{
				"doctype": "POS Profile",
				"name": self.profile_name,
				"company": self.company,
				"currency": self.currency,
				"customer": self.customer,
				"warehouse": leaf("Warehouse", {"company": self.company}),
				"cost_center": cost_center,
				"write_off_account": frappe.db.get_value("Company", self.company, "write_off_account")
				or leaf("Account", {"company": self.company, "account_name": ["like", "%Write Off%"]}),
				"write_off_cost_center": cost_center,
				"write_off_limit": 0,
				"selling_price_list": self.price_list,
				"branch": self.branch_name,
				"restaurant": self.restaurant_name,
				"custom_enable_discount": 1,
				"custom_kot_naming_series": f"QA{self.suffix}KOT-",
				"applicable_for_users": [{"user": self.users["cashier"], "default": 1}],
				"role_allowed_for_billing": [{"role": "URY Cashier"}, {"role": "URY Manager"}],
				"payments": [
					{"mode_of_payment": m, "default": int(i == 0)} for i, m in enumerate(self.modes)
				],
			}
		)
		p.flags.name_set = True
		p.insert(ignore_permissions=True)
		self.profile = p

	def _production_unit(self):
		get_or_create(
			"URY Production Unit",
			self.production_name,
			{
				"pos_profile": self.profile_name,
				"branch": self.branch_name,
				"item_groups": [{"item_group": self.item_group}],
			},
			name_field="production",
		)

	def _opening_entry(self):
		cashier = self.users["cashier"]
		existing = frappe.db.get_value(
			"POS Opening Entry",
			{"pos_profile": self.profile_name, "user": cashier, "status": "Open", "docstatus": 1},
		)
		if existing:
			self.opening_entry = existing
			return
		frappe.set_user(cashier)
		try:
			entry = frappe.new_doc("POS Opening Entry")
			entry.pos_profile = self.profile_name
			entry.user = cashier
			entry.company = self.company
			entry.period_start_date = get_datetime()
			entry.posting_date = frappe.utils.today()
			entry.branch = self.branch_name
			entry.restaurant = self.restaurant_name
			entry.set("balance_details", [{"mode_of_payment": m, "opening_amount": 0} for m in self.modes])
			entry.insert(ignore_permissions=True)
			entry.submit()
			self.opening_entry = entry.name
		finally:
			frappe.set_user("Administrator")

	# -- actions -------------------------------------------------------------

	def as_user(self, role):
		frappe.set_user(self.users[role])

	def order(self, table, items, as_role="cashier", **kwargs):
		"""Place/modify a table order through the real `sync_order` API.

		`items` is a list of (item_code, qty) or dicts with "item"/"qty"/"comment".
		Returns the POS Invoice dict that sync_order returns.
		"""
		from ury.ury.doctype.ury_order.ury_order import sync_order

		payload = [
			i if isinstance(i, dict) else {"item": i[0], "item_name": i[0], "qty": i[1], "comment": ""}
			for i in items
		]
		self.as_user(as_role)
		try:
			return sync_order(
				items=frappe.as_json(payload),
				cashier=self.users["cashier"],
				owner=self.users[as_role],
				mode_of_payment=self.cash,
				customer=kwargs.pop("customer", self.customer),
				no_of_pax=kwargs.pop("no_of_pax", 2),
				last_invoice=kwargs.pop("last_invoice", None),
				waiter=self.users[as_role],
				pos_profile=self.profile_name,
				table=table,
				room=self.room_name,
				**kwargs,
			)
		finally:
			frappe.set_user("Administrator")

	def pay(self, invoice, payments, as_role="cashier", discount=None, table=None):
		"""Settle through the real `make_invoice` API. `payments` = [(mode, amount), ...]."""
		from ury.ury.doctype.ury_order.ury_order import make_invoice

		self.as_user(as_role)
		try:
			return make_invoice(
				customer=self.customer,
				payments=[{"mode_of_payment": m, "amount": a} for m, a in payments],
				cashier=self.users["cashier"],
				pos_profile=self.profile_name,
				owner=self.users[as_role],
				additionalDiscount=discount,
				table=table,
				invoice=invoice,
			)
		finally:
			frappe.set_user("Administrator")

	def expected_total(self, items):
		return sum(flt(self.ITEM_RATES[code]) * flt(qty) for code, qty in items)

	def free_table(self):
		"""First table with no open draft invoice."""
		for t in self.tables:
			if not frappe.db.exists("POS Invoice", {"restaurant_table": t, "docstatus": 0}):
				return t
		raise frappe.ValidationError(f"All QA tables of branch {self.suffix} are busy; reset the QA site")
