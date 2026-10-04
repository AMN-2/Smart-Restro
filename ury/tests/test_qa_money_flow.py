# Copyright (c) 2026, Smart Choice and contributors
# For license information, please see license.txt
"""QA Cat. 3 (unit) + Cat. 9 (money integrity): order -> discount -> payment.

DB-backed, through the real `sync_order` and `make_invoice` APIs, as the real
cashier user. Every expectation is derived from the menu rates in
RestaurantWorld.ITEM_RATES, never from the code under test.

Expectations that encode an undecided business rule are marked
`# NEEDS DECISION` and listed in qa/QA_REPORT.md.
"""

import frappe
from frappe.utils import flt

from ury.tests.qa_base import QATestCase, RestaurantWorld


class TestQAOrderTotals(QATestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = RestaurantWorld.build("A")

	def _open(self, items):
		inv = self.w.order(self.w.free_table(), items)
		self.assertIsInstance(inv, dict, f"sync_order did not return an invoice: {inv}")
		return frappe.get_doc("POS Invoice", inv["name"])

	def test_total_equals_sum_of_menu_rates(self):
		items = [("_QA Burger", 2), ("_QA Tea", 3)]
		inv = self._open(items)
		self.assertEqual(flt(inv.net_total), self.w.expected_total(items))  # 28,500
		for row in inv.items:
			self.assertEqual(flt(row.rate), self.w.ITEM_RATES[row.item_code], "rate must come from the menu")

	def test_client_cannot_set_price(self):
		inv = self._open(
			[{"item": "_QA Burger", "item_name": "_QA Burger", "qty": 1, "rate": 1, "price_list_rate": 1}]
		)
		self.assertEqual(flt(inv.items[0].rate), 12000)

	def test_iqd_rounded_total_is_whole_dinars(self):
		inv = self._open([("_QA Shawarma", 0.3), ("_QA Tea", 1)])  # 1425 + 1500
		self.assertEqual(flt(inv.rounded_total or inv.grand_total) % 1, 0)

	def test_large_order_has_no_float_drift(self):
		items = [("_QA Burger", 10000), ("_QA Shawarma", 3333)]
		inv = self._open(items)
		self.assertEqual(flt(inv.net_total, 2), flt(self.w.expected_total(items), 2))

	def test_negative_qty_line_is_rejected(self):
		# A negative line on a sale is an unaudited discount.
		with self.assertRaises(frappe.ValidationError):
			self._open([("_QA Burger", 2), ("_QA Tea", -3)])

	def test_zero_qty_line_is_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			self._open([("_QA Burger", 0)])

	def test_item_name_is_not_client_controlled(self):
		inv = self._open([{"item": "_QA Tea", "item_name": "FREE ITEM", "qty": 1}])
		# Receipt and KOT print item_name; it must come from the Item master.
		self.assertEqual(inv.items[0].item_name, "_QA Tea")


class TestQAPayment(QATestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = RestaurantWorld.build("A")

	def _bill(self, items=(("_QA Burger", 2), ("_QA Tea", 3))):
		table = self.w.free_table()
		inv = self.w.order(table, list(items))
		return inv["name"], table, self.w.expected_total(items)

	def _payments_on(self, invoice):
		return frappe.get_all(
			"Sales Invoice Payment",
			filters={"parent": invoice, "parenttype": "POS Invoice"},
			fields=["mode_of_payment", "amount"],
		)

	def test_cash_exact(self):
		name, table, total = self._bill()
		self.w.pay(name, [(self.w.cash, total)], table=table)
		inv = frappe.get_doc("POS Invoice", name)
		self.assertEqual(inv.docstatus, 1)
		self.assertEqual(flt(inv.paid_amount), total)
		self.assertEqual(flt(inv.change_amount), 0)

	def test_cash_overpayment_gives_change(self):
		name, table, total = self._bill()
		self.w.pay(name, [(self.w.cash, total + 1500)], table=table)
		inv = frappe.get_doc("POS Invoice", name)
		self.assertEqual(flt(inv.change_amount), 1500)

	def test_mixed_tender_sums_to_total(self):
		if not self.w.card:
			self.skipTest("Site has only one Mode of Payment with an account")
		name, table, total = self._bill()
		self.w.pay(name, [(self.w.cash, 10000), (self.w.card, total - 10000)], table=table)
		rows = self._payments_on(name)
		self.assertEqual(sum(flt(r.amount) for r in rows), total)
		self.assertEqual({r.mode_of_payment for r in rows if flt(r.amount)}, {self.w.cash, self.w.card})

	def test_underpayment_is_rejected_and_bill_stays_open(self):
		name, table, total = self._bill()
		with self.assertRaises(frappe.ValidationError):
			self.w.pay(name, [(self.w.cash, total - 1000)], table=table)
		frappe.db.rollback()
		self.assertEqual(frappe.db.get_value("POS Invoice", name, "docstatus"), 0)

	def test_negative_tender_is_rejected(self):
		if not self.w.card:
			self.skipTest("needs two modes")
		name, table, total = self._bill()
		with self.assertRaises(frappe.ValidationError):
			self.w.pay(name, [(self.w.cash, -5000), (self.w.card, total + 5000)], table=table)

	def test_settling_twice_records_one_payment(self):
		name, table, total = self._bill()
		self.w.pay(name, [(self.w.cash, total)], table=table)
		second = self.w.pay(name, [(self.w.cash, total)], table=table)
		self.assertTrue(second and second.get("already_settled"))
		self.assertEqual(sum(flt(r.amount) for r in self._payments_on(name)), total)

	def test_captain_cannot_settle(self):
		name, table, total = self._bill()
		with self.assertRaises(frappe.PermissionError):
			self.w.pay(name, [(self.w.cash, total)], as_role="captain", table=table)


class TestQADiscount(QATestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = RestaurantWorld.build("A")

	def _bill(self):
		items = [("_QA Burger", 2), ("_QA Tea", 3)]
		table = self.w.free_table()
		inv = self.w.order(table, items)
		return inv["name"], table, self.w.expected_total(items)

	def test_ten_percent(self):
		name, table, total = self._bill()
		payable = total * 0.9
		self.w.pay(name, [(self.w.cash, payable)], discount=10, table=table)
		inv = frappe.get_doc("POS Invoice", name)
		self.assertEqual(flt(inv.grand_total), payable)
		self.assertEqual(flt(inv.discount_amount), total - payable)

	def test_zero_and_negative_mean_no_discount(self):
		for value in (0, -5, "", None):
			name, table, total = self._bill()
			self.w.pay(name, [(self.w.cash, total)], discount=value, table=table)
			self.assertEqual(flt(frappe.db.get_value("POS Invoice", name, "grand_total")), total, value)

	def test_over_one_hundred_percent_is_rejected(self):
		name, table, _total = self._bill()
		with self.assertRaises(frappe.ValidationError):
			self.w.pay(name, [(self.w.cash, 0)], discount=101, table=table)

	def test_non_numeric_discount_is_not_silently_zero(self):
		# flt("abc") == 0, so a garbled discount settles at full price.
		# NEEDS DECISION: reject, or settle at full price? This asserts reject.
		name, table, total = self._bill()
		with self.assertRaises(frappe.ValidationError):
			self.w.pay(name, [(self.w.cash, total)], discount="abc", table=table)

	def test_full_discount(self):
		# NEEDS DECISION: is a 100 % discount (free meal) allowed, and by whom?
		name, table, _total = self._bill()
		self.w.pay(name, [(self.w.cash, 0)], discount=100, table=table)
		self.assertEqual(flt(frappe.db.get_value("POS Invoice", name, "grand_total")), 0)

	def test_discount_is_audited(self):
		name, table, total = self._bill()
		self.w.pay(name, [(self.w.cash, total * 0.8)], discount=20, table=table)
		log = frappe.db.get_value(
			"URY Audit Log",
			{"reference_name": name, "event": "Discount Applied"},
			["performed_by", "old_value", "new_value"],
			as_dict=True,
		)
		self.assertTrue(log, "a discount must leave an audit entry")
		self.assertEqual(log.performed_by, self.w.users["cashier"])
		self.assertEqual(flt(log.new_value), 20)
		# SR-013: old_value is read after the new percentage is assigned.
		self.assertEqual(flt(log.old_value), 0, "audit old_value must be the discount before this change")
