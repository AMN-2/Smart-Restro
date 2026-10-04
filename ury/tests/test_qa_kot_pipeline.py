# Copyright (c) 2026, Smart Choice and contributors
# For license information, please see license.txt
"""QA Cat. 3 + 7: order -> KOT -> kitchen printer / KDS realtime.

SR-008: URY KOT.multi_print_kot wraps print_by_server in `except: pass`; a
        dead kitchen printer leaves no trace.
SR-010: URY KOT.kotDisplayRealtime publishes the full KOT with no room/user,
        i.e. to every Desk user on the site, all branches.
"""

from unittest.mock import patch

import frappe
from frappe.utils import nowtime, today

from ury.tests.qa_base import QATestCase, RestaurantWorld, get_or_create

KOT_MOD = "ury.ury.doctype.ury_kot.ury_kot"
PRINTER = "_QA Kitchen Printer"


class TestQAKotCreation(QATestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = RestaurantWorld.build("A")

	def test_order_creates_one_kot_per_production_with_all_items(self):
		inv = self.w.order(self.w.free_table(), [("_QA Burger", 2), ("_QA Tea", 1)])
		kots = frappe.get_all(
			"URY KOT", filters={"invoice": inv["name"], "docstatus": 1}, fields=["name", "production", "type"]
		)
		self.assertEqual(len(kots), 1, f"expected one KOT for {self.w.production_name}, got {kots}")
		self.assertEqual(kots[0].production, self.w.production_name)
		qty = {
			r.item: float(r.quantity)
			for r in frappe.get_all(
				"URY KOT Items", filters={"parent": kots[0].name}, fields=["item", "quantity"]
			)
		}
		self.assertEqual(qty, {"_QA Burger": 2.0, "_QA Tea": 1.0})

	def test_adding_items_creates_a_modified_kot_for_the_delta_only(self):
		table = self.w.free_table()
		inv = self.w.order(table, [("_QA Burger", 1)])
		self.w.order(
			table, [("_QA Burger", 1), ("_QA Tea", 2)], invoice=inv["name"], last_invoice=inv["name"]
		)
		modified = frappe.get_all(
			"URY KOT",
			filters={"invoice": inv["name"], "type": "Order Modified", "docstatus": 1},
			pluck="name",
		)
		self.assertEqual(len(modified), 1)
		items = frappe.get_all("URY KOT Items", filters={"parent": modified[0]}, fields=["item", "quantity"])
		self.assertEqual({(i.item, float(i.quantity)) for i in items}, {("_QA Tea", 2.0)})


class TestQAKotPrinting(QATestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = RestaurantWorld.build("A")
		get_or_create(
			"Network Printer Settings",
			PRINTER,
			{"server_ip": "127.0.0.1", "port": 631, "printer_name": "qa-null"},
		)

	def _kot(self, production=None):
		doc = frappe.get_doc(
			{
				"doctype": "URY KOT",
				"invoice": "QA-NOT-A-REAL-INVOICE",
				"pos_profile": self.w.profile_name,
				"branch": self.w.branch_name,
				"production": production,
				"date": today(),
				"time": nowtime(),
				"type": "New Order",
				"kot_items": [{"item": "_QA Burger", "item_name": "_QA Burger", "quantity": "1"}],
			}
		)
		doc.name = "QA-KOT-INMEMORY"
		return doc

	def _set_printers(self, parenttype, parent, rows):
		frappe.db.delete("URY Printer Settings", {"parenttype": parenttype, "parent": parent})
		parent_doc = frappe.get_doc(parenttype, parent)
		for r in rows:
			parent_doc.append("printer_settings", r)
		parent_doc.save(ignore_permissions=True)

	def test_print_failure_is_recorded(self):
		self._set_printers(
			"URY Production Unit", self.w.production_name, [{"printer": PRINTER, "custom_kot_print": 1}]
		)
		before = frappe.db.count("Error Log") + frappe.db.count("URY KOT Error Log")
		with (
			patch(f"{KOT_MOD}.print_by_server", side_effect=Exception("printer offline")),
			patch("ury.ury.api.qz_printing.queue_kot", return_value=False),
		):
			self._kot(self.w.production_name).multi_print_kot()
		after = frappe.db.count("Error Log") + frappe.db.count("URY KOT Error Log")
		self.assertGreater(
			after, before, "SR-008: kitchen printer failure left no Error Log / KOT Error Log entry"
		)

	def test_pos_profile_kot_printer_used_without_production_printer(self):
		# NEEDS DECISION: should the POS Profile's KOT printer act as fallback
		# when the production unit has no printer? Today nothing prints.
		self._set_printers("URY Production Unit", self.w.production_name, [])
		self._set_printers("POS Profile", self.w.profile_name, [{"printer": PRINTER, "custom_kot_print": 1}])
		with (
			patch(f"{KOT_MOD}.print_by_server") as printed,
			patch("ury.ury.api.qz_printing.queue_kot", return_value=False),
		):
			self._kot(self.w.production_name).multi_print_kot()
		self.assertTrue(printed.called, "KOT was not sent to any printer")


class TestQAKotRealtimeScope(QATestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = RestaurantWorld.build("A")

	def test_kot_event_is_not_broadcast_site_wide(self):
		kot = frappe.get_doc(
			{
				"doctype": "URY KOT",
				"pos_profile": self.w.profile_name,
				"branch": self.w.branch_name,
				"production": self.w.production_name,
				"date": today(),
				"time": nowtime(),
				"kot_items": [],
			}
		)
		with patch(f"{KOT_MOD}.frappe.publish_realtime") as pub:
			kot.kotDisplayRealtime()
		self.assertTrue(pub.called)
		kwargs = pub.call_args.kwargs
		scoped = any(kwargs.get(k) for k in ("room", "user", "doctype", "docname"))
		self.assertTrue(
			scoped,
			"SR-010: KOT payload (customer, table, items) published to the whole site room; "
			f"call was {pub.call_args}",
		)
