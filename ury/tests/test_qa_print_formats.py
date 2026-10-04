# Copyright (c) 2026, Smart Choice and contributors
# For license information, please see license.txt
"""QA Cat. 11: kitchen ticket, waiter slip and merged invoice print formats.

Frappe's Jinja environment does not autoescape (frappe/utils/jinja.py), so
print formats are only safe if user text is sanitized on the way in. These
tests push hostile and Arabic text through the real order path (sync_order ->
KOT), then render the real print formats.

Rendered HTML/PDF are written to qa/evidence/print/ for the human check of
Arabic shaping, RTL and 58/80 mm layout, which a test cannot judge.
"""

import os

import frappe
from frappe.utils import get_bench_path

from ury.tests.qa_base import QATestCase, RestaurantWorld

EVIDENCE = os.path.join(get_bench_path(), "apps", "ury", "qa", "evidence", "print")
XSS_NOTE = '<script>alert("kot")</script><img src=x onerror=alert(1)>بدون بصل'
LONG_AR = "برجر لحم مشوي على الفحم مع جبنة شيدر إضافية وخضار طازجة وصلصة الثوم الخاصة"
HOSTILE_MARKERS = ("<script", "onerror", "javascript:")


class TestQAPrintFormats(QATestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = RestaurantWorld.build("A")
		frappe.db.set_value("Item", "_QA Burger", "item_name", LONG_AR)
		inv = cls.w.order(
			cls.w.free_table(),
			[
				{"item": "_QA Burger", "item_name": LONG_AR, "qty": 2, "comment": XSS_NOTE},
				{"item": "_QA Tea", "item_name": "شاي", "qty": 1, "comment": ""},
			],
			comments=XSS_NOTE,
		)
		cls.invoice = inv["name"]
		cls.kot = frappe.db.get_value("URY KOT", {"invoice": cls.invoice, "docstatus": 1})
		os.makedirs(EVIDENCE, exist_ok=True)

	@classmethod
	def tearDownClass(cls):
		frappe.db.set_value("Item", "_QA Burger", "item_name", "_QA Burger")
		super().tearDownClass()

	def _render(self, doctype, name, fmt, tag):
		html = frappe.get_print(doctype, name, print_format=fmt)
		with open(os.path.join(EVIDENCE, f"{tag}.html"), "w") as fh:
			fh.write(html)
		return html

	def _assert_safe(self, html, where):
		low = html.lower()
		for marker in HOSTILE_MARKERS:
			self.assertNotIn(marker, low, f"{where}: unescaped '{marker}' from user input in print output")

	def test_kitchen_ticket(self):
		self.assertTrue(self.kot, "order produced no KOT")
		html = self._render("URY KOT", self.kot, "URY Kitchen Ticket", "kitchen_ticket")
		self._assert_safe(html, "URY Kitchen Ticket")
		self.assertIn("بدون بصل", html, "the safe part of the kitchen note was lost")
		self.assertIn("شاي", html)

	def test_waiter_slip(self):
		html = self._render("URY KOT", self.kot, "URY Waiter Order Slip", "waiter_slip")
		self._assert_safe(html, "URY Waiter Order Slip")

	def test_merged_invoice_receipt_totals(self):
		html = self._render("POS Invoice", self.invoice, "Merged POS Invoice Format", "merged_invoice")
		self._assert_safe(html, "Merged POS Invoice Format")
		grand_total = frappe.db.get_value("POS Invoice", self.invoice, "grand_total")
		currency = frappe.db.get_value("POS Invoice", self.invoice, "currency")
		self.assertIn(frappe.utils.fmt_money(round(grand_total), currency=currency), html)

	def test_pdfs_for_manual_review(self):
		for fmt, tag in (("URY Kitchen Ticket", "kitchen_ticket"), ("URY Waiter Order Slip", "waiter_slip")):
			pdf = frappe.get_print("URY KOT", self.kot, print_format=fmt, as_pdf=True)
			self.assertGreater(len(pdf), 1000, f"{fmt}: empty PDF")
			with open(os.path.join(EVIDENCE, f"{tag}.pdf"), "wb") as fh:
				fh.write(pdf)
