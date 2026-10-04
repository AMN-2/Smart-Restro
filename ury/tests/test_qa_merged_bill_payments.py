# Copyright (c) 2026, Smart Choice and contributors
# For license information, please see license.txt
"""QA Cat. 9: merged-bill payment integrity (SR-005).

ury/ury/hooks/ury_pos_invoice.py:sync_merged_invoice runs on every on_update /
on_submit of a POS Invoice that has `custom_merged_pos_invoice`, unless the
caller set `flags.ignore_payment_sync` (only make_invoice does). For each
payment row on the paid invoice it appends a row to the merged partner with
`amount = target.rounded_total`. One tender row: correct. Two tender rows
(cash + card): the partner records twice its total.
"""

import frappe
from frappe.utils import flt

from ury.tests.qa_base import QATestCase, RestaurantWorld


class TestQAMergedBillPayments(QATestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = RestaurantWorld.build("A")

	def _pair(self):
		t1, t2 = self.w.free_table(), None
		p = self.w.order(t1, [("_QA Burger", 1)])
		t2 = self.w.free_table()
		s = self.w.order(t2, [("_QA Tea", 2)])
		frappe.db.set_value("POS Invoice", p["name"], "custom_merged_pos_invoice", s["name"])
		return p["name"], s["name"], t1

	def _paid(self, name):
		return sum(
			flt(r.amount)
			for r in frappe.get_all(
				"Sales Invoice Payment",
				filters={"parent": name, "parenttype": "POS Invoice"},
				fields=["amount"],
			)
		)

	def test_mixed_tender_on_save_does_not_inflate_partner(self):
		if not self.w.card:
			self.skipTest("needs two modes of payment")
		p, s, _t = self._pair()
		self.w.as_user("cashier")
		doc = frappe.get_doc("POS Invoice", p)
		doc.set("payments", [])
		doc.append("payments", {"mode_of_payment": self.w.cash, "amount": 5000})
		doc.append("payments", {"mode_of_payment": self.w.card, "amount": 7000})
		doc.save()
		frappe.set_user("Administrator")
		partner_total = flt(frappe.db.get_value("POS Invoice", s, "rounded_total") or 3000)
		self.assertEqual(self._paid(s), partner_total, "merged partner recorded more than its own total")

	def test_settle_merged_bill_via_make_invoice_splits_tender(self):
		if not self.w.card:
			self.skipTest("needs two modes of payment")
		p, s, t = self._pair()
		combined = 12000 + 3000
		self.w.pay(p, [(self.w.cash, 10000), (self.w.card, combined - 10000)], table=t)
		self.assertEqual(self._paid(p), 12000)
		self.assertEqual(self._paid(s), 3000)
		self.assertEqual(frappe.db.get_value("POS Invoice", p, "docstatus"), 1)
		self.assertEqual(
			frappe.db.get_value("POS Invoice", s, "docstatus"),
			1,
			"the merged partner must be settled with the primary bill",
		)

	def test_partner_sync_failure_is_not_silent(self):
		# sync_merged_invoice catches every exception into Error Log; the
		# primary is then paid while the partner stays an open draft.
		p, s, t = self._pair()
		frappe.db.set_value("POS Invoice", s, "customer", None)  # make partner save fail
		before = frappe.db.count("Error Log", {"method": "Merged Invoice Sync Failed"})
		try:
			self.w.pay(p, [(self.w.cash, 15000)], table=t)
		except frappe.ValidationError:
			return  # surfacing the failure to the cashier is acceptable
		partner_status = frappe.db.get_value("POS Invoice", s, "docstatus")
		self.assertEqual(
			partner_status,
			1,
			f"primary settled while partner left at docstatus={partner_status}; "
			f"Error Log entries added: {frappe.db.count('Error Log', {'method': 'Merged Invoice Sync Failed'}) - before}",
		)
