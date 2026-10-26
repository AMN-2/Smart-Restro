"""POS Closing Entry that knows who a URY bill belongs to.

ERPNext only lets a closing entry attach invoices whose `owner` is the
cashier closing the shift. In URY the captain who took the order creates the
POS Invoice and the cashier who took the money is recorded in `cashier`, so
the stock rule would turn away most of a shift's bills. Everything else
ERPNext checks — not yet consolidated, same POS Profile, submitted — still
applies.
"""

import frappe
from frappe import _
from erpnext.accounts.doctype.pos_closing_entry.pos_closing_entry import POSClosingEntry

from ury.ury.api.pos_closing import belongs_to_shift, other_open_cashiers


class URYPOSClosingEntry(POSClosingEntry):
	def validate_pos_invoices(self):
		opening_entry = frappe._dict(
			name=self.pos_opening_entry, pos_profile=self.pos_profile, user=self.user
		)
		other_cashiers = other_open_cashiers(opening_entry)

		error_list = []
		for d in self.pos_transactions:
			invoice = frappe.db.get_value(
				"POS Invoice",
				d.pos_invoice,
				["consolidated_invoice", "pos_profile", "docstatus", "owner", "cashier"],
				as_dict=True,
			)
			if not invoice:
				error_list.append(_("Row #{}: POS Invoice {} not found").format(d.idx, d.pos_invoice))
				continue
			if invoice.consolidated_invoice:
				error_list.append(_("Row #{}: {}").format(d.idx, _("POS Invoice is already consolidated")))
				continue
			if invoice.pos_profile != self.pos_profile:
				error_list.append(
					_("Row #{}: {}").format(
						d.idx, _("POS Profile doesn't match {}").format(frappe.bold(self.pos_profile))
					)
				)
			if invoice.docstatus != 1:
				error_list.append(_("Row #{}: {}").format(d.idx, _("POS Invoice is not submitted")))
			if not belongs_to_shift(invoice, other_cashiers):
				error_list.append(
					_("Row #{}: POS Invoice {} belongs to {}, who has a shift of their own open").format(
						d.idx, d.pos_invoice, frappe.bold(invoice.cashier or invoice.owner)
					)
				)

		if error_list:
			frappe.throw(error_list, title=_("Invalid POS Invoices"), as_list=True)
