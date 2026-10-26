from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from ury.ury.api import pos_closing
from ury.ury.overrides.pos_closing_entry import URYPOSClosingEntry

MODULE = "ury.ury.api.pos_closing"


def invoice(name, cashier=None, owner="captain@x", docstatus=1, **extra):
	return frappe._dict(name=name, cashier=cashier, owner=owner, docstatus=docstatus, **extra)


class TestBelongsToShift(FrappeTestCase):
	def test_captain_bill_paid_by_this_cashier_belongs_to_the_shift(self):
		self.assertTrue(pos_closing.belongs_to_shift(invoice("A", cashier="cashier@x"), set()))

	def test_bill_of_a_cashier_with_their_own_open_shift_is_left_out(self):
		self.assertFalse(pos_closing.belongs_to_shift(invoice("A", cashier="other@x"), {"other@x"}))

	def test_owner_counts_when_no_cashier_was_recorded(self):
		self.assertFalse(pos_closing.belongs_to_shift(invoice("A", owner="other@x"), {"other@x"}))
		self.assertTrue(pos_closing.belongs_to_shift(invoice("A", owner="captain@x"), {"other@x"}))


class TestGetShiftInvoices(FrappeTestCase):
	@patch(f"{MODULE}.other_open_cashiers", return_value={"other@x"})
	@patch(f"{MODULE}.frappe.db.sql")
	def test_splits_paid_bills_from_open_ones_and_skips_other_shifts(self, sql, _others):
		sql.return_value = [
			invoice("PAID-1", cashier="cashier@x"),
			invoice("PAID-2", cashier=None, owner="captain@x"),
			invoice("OTHER", cashier="other@x"),
			invoice("OPEN-1", cashier="cashier@x", docstatus=0),
		]
		opening = frappe._dict(name="POE-1", pos_profile="P", user="cashier@x", period_start_date="2026-10-26 08:00:00")

		submitted, drafts = pos_closing.get_shift_invoices(opening, "2026-10-26 20:00:00")

		self.assertEqual([row.name for row in submitted], ["PAID-1", "PAID-2"])
		self.assertEqual(drafts, ["OPEN-1"])


class TestSummarize(FrappeTestCase):
	@patch(f"{MODULE}.frappe.get_all")
	def test_change_comes_out_of_the_cash_mode_and_taxes_merge(self, get_all):
		invoices = [
			invoice("A", grand_total=12000, net_total=10000, total_qty=2, change_amount=3000, account_for_change_amount="Cash - X", customer="C", posting_date="2026-10-26"),
			invoice("B", grand_total=5000, net_total=5000, total_qty=1, change_amount=0, account_for_change_amount="Cash - X", customer="C", posting_date="2026-10-26"),
		]
		payments = [
			frappe._dict(parent="A", mode_of_payment="Cash", account="Cash - X", amount=15000),
			frappe._dict(parent="B", mode_of_payment="Card", account="Bank - X", amount=5000),
		]
		taxes = [
			frappe._dict(account_head="VAT - X", rate=10, tax_amount=1000),
			frappe._dict(account_head="VAT - X", rate=10, tax_amount=500),
		]
		get_all.side_effect = lambda doctype, **_: payments if doctype == "Sales Invoice Payment" else taxes

		summary = pos_closing.summarize(invoices)

		self.assertEqual(summary["sales_by_mode"], {"Cash": 12000, "Card": 5000})
		self.assertEqual(summary["grand_total"], 17000)
		self.assertEqual(summary["total_quantity"], 3)
		self.assertEqual(summary["taxes"], [{"account_head": "VAT - X", "rate": 10, "amount": 1500}])
		self.assertEqual([row["name"] for row in summary["invoices"]], ["A", "B"])


class TestCloseShift(FrappeTestCase):
	@patch(f"{MODULE}.get_shift_invoices", return_value=([], ["OPEN-1"]))
	@patch(f"{MODULE}.get_own_opening_entry")
	def test_refuses_to_close_over_open_bills(self, _opening, _invoices):
		with self.assertRaises(frappe.ValidationError):
			pos_closing.close_shift("POE-1", [])

	@patch(f"{MODULE}.frappe.get_doc")
	@patch(f"{MODULE}.summarize", return_value={"invoices": [{"name": "A"}, {"name": "B"}]})
	@patch(f"{MODULE}.get_shift_invoices", return_value=([invoice("A"), invoice("B")], []))
	@patch(f"{MODULE}.get_own_opening_entry")
	def test_bills_paid_since_the_summary_leave_the_shift_open(self, _opening, _invoices, _summary, get_doc):
		result = pos_closing.close_shift("POE-1", [], invoice_names=["A"])

		self.assertEqual(result["status"], "invoices_changed")
		get_doc.assert_not_called()


class TestClosingEntryOwnership(FrappeTestCase):
	def make_entry(self):
		return frappe._dict(
			pos_opening_entry="POE-1",
			pos_profile="P",
			user="cashier@x",
			pos_transactions=[frappe._dict(idx=1, pos_invoice="A")],
		)

	@patch("ury.ury.overrides.pos_closing_entry.other_open_cashiers", return_value=set())
	@patch("ury.ury.overrides.pos_closing_entry.frappe.db.get_value")
	def test_accepts_a_bill_the_captain_created(self, get_value, _others):
		get_value.return_value = frappe._dict(
			consolidated_invoice=None, pos_profile="P", docstatus=1, owner="captain@x", cashier="cashier@x"
		)
		URYPOSClosingEntry.validate_pos_invoices(self.make_entry())

	@patch("ury.ury.overrides.pos_closing_entry.other_open_cashiers", return_value={"other@x"})
	@patch("ury.ury.overrides.pos_closing_entry.frappe.db.get_value")
	def test_rejects_a_bill_of_another_open_shift(self, get_value, _others):
		get_value.return_value = frappe._dict(
			consolidated_invoice=None, pos_profile="P", docstatus=1, owner="captain@x", cashier="other@x"
		)
		with self.assertRaises(frappe.ValidationError):
			URYPOSClosingEntry.validate_pos_invoices(self.make_entry())
