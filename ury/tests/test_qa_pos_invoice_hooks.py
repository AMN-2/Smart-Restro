# Copyright (c) 2026, Smart Choice and contributors
# For license information, please see license.txt
"""QA Cat. 3: POS Invoice doc_events and order lifecycle.

Covers SR-004 (post-print removal guard), SR-007 (order number derivation),
split bill money conservation and void/cancel.
"""

from unittest.mock import patch

import frappe
from frappe.utils import flt

from ury.tests.qa_base import QATestCase, RestaurantWorld


class TestQAPostPrintGuard(QATestCase):
	"""ury/ury/hooks/ury_pos_invoice.py:validate_invoice"""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = RestaurantWorld.build("A")
		frappe.db.set_value("POS Profile", cls.w.profile_name, "remove_items", 0)

	def _printed_bill(self, items):
		inv = self.w.order(self.w.free_table(), items)
		frappe.db.set_value("POS Invoice", inv["name"], "invoice_printed", 1)
		return inv["name"]

	def test_removing_a_whole_item_after_print_is_blocked(self):
		name = self._printed_bill([("_QA Burger", 1), ("_QA Tea", 1)])
		self.w.as_user("cashier")
		doc = frappe.get_doc("POS Invoice", name)
		doc.remove(next(r for r in doc.items if r.item_code == "_QA Tea"))
		with self.assertRaises(frappe.ValidationError):
			doc.save()

	def test_removing_one_of_two_rows_of_the_same_item_after_print_is_blocked(self):
		# SR-004: rows are keyed by item_code, so the second "_QA Tea" row
		# overwrites the first and the removal is invisible to the guard.
		name = self._printed_bill(
			[
				{"item": "_QA Tea", "item_name": "_QA Tea", "qty": 1, "comment": "no sugar"},
				{"item": "_QA Tea", "item_name": "_QA Tea", "qty": 1, "comment": ""},
				("_QA Burger", 1),
			]
		)
		self.w.as_user("cashier")
		doc = frappe.get_doc("POS Invoice", name)
		tea_rows = [r for r in doc.items if r.item_code == "_QA Tea"]
		self.assertEqual(len(tea_rows), 2, "fixture: expected two separate tea rows")
		before = flt(doc.net_total)
		doc.remove(tea_rows[0])
		with self.assertRaises(
			frappe.ValidationError, msg=f"printed bill reduced from {before} without error"
		):
			doc.save()

	def test_reducing_qty_after_print_is_blocked(self):
		name = self._printed_bill([("_QA Burger", 3)])
		self.w.as_user("cashier")
		doc = frappe.get_doc("POS Invoice", name)
		doc.items[0].qty = 1
		with self.assertRaises(frappe.ValidationError):
			doc.save()

	def test_sync_order_cannot_reduce_a_printed_bill(self):
		inv = self.w.order(self.w.free_table(), [("_QA Burger", 2)])
		frappe.db.set_value("POS Invoice", inv["name"], "invoice_printed", 1)
		with self.assertRaises(frappe.PermissionError):
			self.w.order(
				inv["restaurant_table"], [("_QA Burger", 1)], invoice=inv["name"], last_invoice=inv["name"]
			)


class TestQAOrderNumber(QATestCase):
	"""ury/ury/api/ury_kot_order_number.py:set_order_number (SR-007).

	Pure unit tests: the DB writes are captured, nothing is inserted.
	"""

	MOD = "ury.ury.api.ury_kot_order_number"

	def _number(self, name, last_invoice, order_type="Dine In"):
		doc = frappe._dict(name=name, pos_profile="_QA POS Profile A", order_type=order_type)
		captured = {}

		def fake_set_value(doctype, docname, field, value, **kw):
			captured[field] = value

		with (
			patch(f"{self.MOD}.frappe.get_value", return_value=last_invoice),
			patch(f"{self.MOD}.frappe.db.set_value", side_effect=fake_set_value),
		):
			from ury.ury.api.ury_kot_order_number import set_order_number

			set_order_number(doc, "after_insert")
		return captured.get("custom_ury_order_number")

	def test_sequential_within_shift(self):
		self.assertEqual(self._number("QAAINV00057", "QAAINV00050"), 7)

	def test_series_past_99999(self):
		# Five-# series overflow to six digits; [-5:] then drops the leading 1.
		self.assertEqual(self._number("QAAINV100003", "QAAINV099998"), 5)

	def test_amended_invoice_name_does_not_crash(self):
		# Amended names end in "-1": int("012-1") raises ValueError in after_insert,
		# which would abort the insert of the amended invoice.
		try:
			self._number("QAAINV00012-1", "QAAINV00010")
		except ValueError as e:
			self.fail(f"order number derivation crashed on an amended name: {e}")

	def test_aggregator_prefix(self):
		self.assertEqual(self._number("QAAAGG00012", "QAAAGG00010", "Aggregators"), "AGR - 2")


class TestQASplitBill(QATestCase):
	"""ury_order.split_bill must conserve money: source + new == original."""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = RestaurantWorld.build("A")

	def test_split_conserves_total(self):
		from ury.ury.doctype.ury_order.ury_order import split_bill

		items = [("_QA Burger", 3), ("_QA Tea", 2)]
		inv = self.w.order(self.w.free_table(), items)
		frappe.db.set_value("POS Invoice", inv["name"], "invoice_printed", 1)
		original = self.w.expected_total(items)
		burger_row = frappe.db.get_value(
			"POS Invoice Item", {"parent": inv["name"], "item_code": "_QA Burger"}
		)

		self.w.as_user("cashier")
		out = split_bill(inv["name"], frappe.as_json([{"name": burger_row, "qty": 1}]))
		frappe.set_user("Administrator")

		a = flt(frappe.db.get_value("POS Invoice", out["source_invoice"], "net_total"))
		b = flt(frappe.db.get_value("POS Invoice", out["new_invoice"], "net_total"))
		self.assertEqual(a + b, original)
		self.assertEqual(b, 12000)

	def test_cannot_move_more_than_available(self):
		from ury.ury.doctype.ury_order.ury_order import split_bill

		inv = self.w.order(self.w.free_table(), [("_QA Burger", 1), ("_QA Tea", 1)])
		row = frappe.db.get_value("POS Invoice Item", {"parent": inv["name"], "item_code": "_QA Tea"})
		self.w.as_user("cashier")
		with self.assertRaises(frappe.ValidationError):
			split_bill(inv["name"], frappe.as_json([{"name": row, "qty": 5}]))

	def test_captain_cannot_split(self):
		# NEEDS DECISION: splitting changes who pays what; it is gated like settling?
		from ury.ury.doctype.ury_order.ury_order import split_bill

		inv = self.w.order(self.w.free_table(), [("_QA Burger", 2), ("_QA Tea", 1)])
		row = frappe.db.get_value("POS Invoice Item", {"parent": inv["name"], "item_code": "_QA Burger"})
		self.w.as_user("captain")
		with self.assertRaises(frappe.PermissionError):
			split_bill(inv["name"], frappe.as_json([{"name": row, "qty": 1}]))


class TestQACancelOrder(QATestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = RestaurantWorld.build("A")

	def test_cashier_can_void_and_table_is_freed(self):
		from ury.ury.doctype.ury_order.ury_order import cancel_order

		table = self.w.free_table()
		inv = self.w.order(table, [("_QA Burger", 1)])
		self.w.as_user("cashier")
		cancel_order(inv["name"], "QA void")
		frappe.set_user("Administrator")
		self.assertIn(frappe.db.get_value("POS Invoice", inv["name"], "docstatus"), (2, None))
		self.assertEqual(frappe.db.get_value("URY Table", table, "occupied"), 0)

	def test_captain_cannot_void(self):
		from ury.ury.doctype.ury_order.ury_order import cancel_order

		inv = self.w.order(self.w.free_table(), [("_QA Burger", 1)])
		self.w.as_user("captain")
		with self.assertRaises(frappe.PermissionError):
			cancel_order(inv["name"], "QA void")
