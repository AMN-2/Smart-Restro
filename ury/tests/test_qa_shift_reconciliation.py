# Copyright (c) 2026, Smart Choice and contributors
# For license information, please see license.txt
"""QA Cat. 9: shift close and cash reconciliation.

SR-003: ury/ury/hooks/ury_pos_closing_entry.py:calculate_closing_amount looks
up Sub POS Closing by date window only — no pos_profile / branch / opening
entry filter — and then uses only the first row. With multi-cashier enabled,
branch A's closing can add branch B's sub-cashier cash.
"""

import frappe
from frappe.utils import add_to_date, flt, now_datetime, nowtime, today

from ury.tests.qa_base import QATestCase, RestaurantWorld


def _insert_submitted_sub_closing(world, closing_amount):
	"""A submitted Sub POS Closing for `world`, written directly (no validation):
	this test is about how the closing hook *selects* sub closings, not how they
	are produced."""
	doc = frappe.get_doc(
		{
			"doctype": "Sub POS Closing",
			"period_start_date": add_to_date(now_datetime(), hours=-1),
			"period_end_date": now_datetime(),
			"posting_date": today(),
			"posting_time": nowtime(),
			"pos_opening_entry": world.opening_entry,
			"company": world.company,
			"pos_profile": world.profile_name,
			"user": world.users["cashier"],
			"payment_reconciliation": [{"mode_of_payment": world.cash, "closing_amount": closing_amount}],
		}
	)
	doc.set_new_name()
	doc.docstatus = 1
	doc.db_insert()
	for row in doc.get_all_children():
		row.parent = doc.name
		row.docstatus = 1
		row.db_insert()
	return doc.name


class TestQASubClosingScope(QATestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.a = RestaurantWorld.build("A")
		cls.b = RestaurantWorld.build("B")

	def setUp(self):
		super().setUp()
		frappe.db.set_value("POS Profile", self.a.profile_name, "custom_enable_multiple_cashier", 1)

	def tearDown(self):
		frappe.db.set_value("POS Profile", self.a.profile_name, "custom_enable_multiple_cashier", 0)
		super().tearDown()

	def _closing_for_a(self, main_cash):
		return frappe._dict(
			pos_profile=self.a.profile_name,
			posting_date=today(),
			period_start_date=add_to_date(now_datetime(), hours=-2),
			payment_reconciliation=[
				frappe._dict(
					mode_of_payment=self.a.cash, custom_closing_amount=main_cash, expected_amount=main_cash
				)
			],
		)

	def test_other_branch_sub_closing_is_not_counted(self):
		from ury.ury.hooks.ury_pos_closing_entry import calculate_closing_amount

		_insert_submitted_sub_closing(self.b, 999_000)
		doc = self._closing_for_a(main_cash=50_000)
		try:
			calculate_closing_amount(doc, "validate")
		except frappe.ValidationError:
			# Acceptable: "No Sub POS Closing entries found" for branch A.
			return
		self.assertEqual(
			flt(doc.payment_reconciliation[0].closing_amount),
			50_000,
			"branch B's sub-cashier cash was added to branch A's closing",
		)

	def test_all_own_sub_closings_are_summed(self):
		# NEEDS DECISION: with two sub-cashiers on one profile, both must count.
		from ury.ury.hooks.ury_pos_closing_entry import calculate_closing_amount

		_insert_submitted_sub_closing(self.a, 10_000)
		_insert_submitted_sub_closing(self.a, 7_000)
		doc = self._closing_for_a(main_cash=50_000)
		calculate_closing_amount(doc, "validate")
		self.assertEqual(flt(doc.payment_reconciliation[0].closing_amount), 67_000)


class TestQAExpectedCash(QATestCase):
	"""ERPNext's expected cash for a shift must equal
	opening + cash tendered - change given, computed independently here."""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = RestaurantWorld.build("C")  # own branch: this test closes the shift

	def test_expected_cash_matches_independent_sum(self):
		from erpnext.accounts.doctype.pos_closing_entry.pos_closing_entry import (
			make_closing_entry_from_opening,
		)

		bills = [
			([("_QA Burger", 1)], [(self.w.cash, 15000)]),  # change 3000
			([("_QA Tea", 2)], [(self.w.cash, 3000)]),
		]
		if self.w.card:
			bills.append(([("_QA Shawarma", 2)], [(self.w.cash, 4500), (self.w.card, 5000)]))

		expected_cash = 0
		for items, tender in bills:
			table = self.w.free_table()
			inv = self.w.order(table, items)
			self.w.pay(inv["name"], tender, table=table)
			total = self.w.expected_total(items)
			cash_in = sum(a for m, a in tender if m == self.w.cash)
			non_cash = sum(a for m, a in tender if m != self.w.cash)
			expected_cash += cash_in - max(0, cash_in + non_cash - total)

		opening = frappe.get_doc("POS Opening Entry", self.w.opening_entry)
		closing = make_closing_entry_from_opening(opening)
		cash_row = next(r for r in closing.payment_reconciliation if r.mode_of_payment == self.w.cash)
		self.assertEqual(flt(cash_row.expected_amount), flt(cash_row.opening_amount) + expected_cash)


class TestQAGLBalance(QATestCase):
	"""After the shift closes and ERPNext consolidates, GL must balance and the
	tender split must reach the right accounts."""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = RestaurantWorld.build("D")

	def test_consolidated_invoice_gl_balances(self):
		from erpnext.accounts.doctype.pos_closing_entry.pos_closing_entry import (
			make_closing_entry_from_opening,
		)

		table = self.w.free_table()
		inv = self.w.order(table, [("_QA Burger", 2)])
		self.w.pay(inv["name"], [(self.w.cash, 24000)], table=table)

		closing = make_closing_entry_from_opening(frappe.get_doc("POS Opening Entry", self.w.opening_entry))
		for row in closing.payment_reconciliation:
			row.closing_amount = row.expected_amount
		closing.insert(ignore_permissions=True)
		closing.submit()

		frappe.db.commit()
		consolidated = frappe.db.get_value("POS Invoice", inv["name"], "consolidated_invoice")
		self.assertTrue(consolidated, "POS Invoice was not consolidated into a Sales Invoice")

		gl = frappe.db.sql(
			"""SELECT SUM(debit) d, SUM(credit) c FROM `tabGL Entry`
			WHERE voucher_type='Sales Invoice' AND voucher_no=%s AND is_cancelled=0""",
			consolidated,
			as_dict=True,
		)[0]
		self.assertEqual(flt(gl.d, 2), flt(gl.c, 2), "GL debit != credit")

		cash_account = frappe.db.get_value(
			"Mode of Payment Account", {"parent": self.w.cash, "company": self.w.company}, "default_account"
		)
		cash_debit = frappe.db.sql(
			"""SELECT SUM(debit) - SUM(credit) FROM `tabGL Entry`
			WHERE voucher_no=%s AND account=%s AND is_cancelled=0""",
			(consolidated, cash_account),
		)[0][0]
		self.assertEqual(flt(cash_debit), 24000)
