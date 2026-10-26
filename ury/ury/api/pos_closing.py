"""Closing a cashier's shift into a POS Closing Entry.

The cashier screen used to build the POS Closing Entry in the browser and
sent it without `pos_transactions`, so ERPNext had nothing to consolidate:
the shift closed, but its POS Invoices stayed loose and never reached a
Sales Invoice. ERPNext's own `get_pos_invoices` would not have been enough
either, because it only picks invoices whose `owner` is the cashier, and in
URY the bill is usually created by the captain who took the order — the
cashier is recorded in `cashier`.

Both the closing screen's summary and the close itself go through
`get_shift_invoices()` here, so what the cashier counts against is exactly
what gets attached. The close runs in one request on the server: the entry
is built, inserted and submitted together, and if anything fails nothing is
left behind.
"""

import json

import frappe
from frappe import _
from frappe.utils import flt, get_datetime, now_datetime

SUPERVISOR_ROLES = {"URY Manager", "System Manager"}

INVOICE_FIELDS = """
    name, owner, cashier, docstatus, customer, posting_date, grand_total,
    net_total, total_qty, change_amount, account_for_change_amount,
    timestamp(posting_date, posting_time) as `timestamp`
"""


def other_open_cashiers(opening_entry):
    """Users holding another open shift on the same POS Profile. Their bills
    are theirs to close, so they are left out of this shift."""
    return set(
        frappe.get_all(
            "POS Opening Entry",
            filters={
                "pos_profile": opening_entry.pos_profile,
                "status": "Open",
                "docstatus": 1,
                "name": ["!=", opening_entry.name],
            },
            pluck="user",
        )
    ) - {opening_entry.user}


def belongs_to_shift(invoice, other_cashiers):
    """A bill belongs to whoever took the money for it (`cashier`), or to
    whoever made it when no cashier was recorded."""
    return (invoice.cashier or invoice.owner) not in other_cashiers


def get_shift_invoices(opening_entry, end=None):
    """The POS Invoices this shift closes, and the bills still open in it.

    Returns ``(submitted, drafts)``. Submitted invoices are the ones on this
    POS Profile, not yet consolidated, posted between the shift's start and
    `end`. Drafts are bills opened during the shift and never settled;
    a shift cannot close over them, since they would have no shift left to
    be paid into.
    """
    start = get_datetime(opening_entry.period_start_date)
    end = get_datetime(end or now_datetime())
    other_cashiers = other_open_cashiers(opening_entry)

    rows = frappe.db.sql(
        f"""
        select {INVOICE_FIELDS}
        from `tabPOS Invoice`
        where pos_profile = %(pos_profile)s
            and ifnull(consolidated_invoice, '') = ''
            and (
                (docstatus = 1 and timestamp(posting_date, posting_time) between %(start)s and %(end)s)
                or (docstatus = 0 and creation >= %(start)s)
            )
        order by `timestamp`, name
        """,
        {"pos_profile": opening_entry.pos_profile, "start": start, "end": end},
        as_dict=True,
    )
    rows = [row for row in rows if belongs_to_shift(row, other_cashiers)]

    submitted = [row for row in rows if row.docstatus == 1]
    drafts = [row.name for row in rows if row.docstatus == 0]
    return submitted, drafts


def summarize(invoices):
    """Totals, taxes and per-mode sales for a list of POS Invoice rows, in
    the shape the POS Closing Entry stores them."""
    names = [invoice.name for invoice in invoices]
    by_name = {invoice.name: invoice for invoice in invoices}

    sales_by_mode = {}
    for payment in frappe.get_all(
        "Sales Invoice Payment",
        filters={"parenttype": "POS Invoice", "parent": ["in", names or [""]]},
        fields=["parent", "mode_of_payment", "account", "amount"],
        order_by="idx",
    ):
        invoice = by_name[payment.parent]
        amount = flt(payment.amount)
        # Change handed back comes out of the account it was paid from,
        # the same way ERPNext's own closing form counts it.
        if payment.account == invoice.account_for_change_amount:
            amount -= flt(invoice.change_amount)
        sales_by_mode[payment.mode_of_payment] = sales_by_mode.get(payment.mode_of_payment, 0) + amount

    taxes = {}
    for tax in frappe.get_all(
        "Sales Taxes and Charges",
        filters={"parenttype": "POS Invoice", "parent": ["in", names or [""]]},
        fields=["account_head", "rate", "tax_amount"],
    ):
        key = (tax.account_head, flt(tax.rate))
        row = taxes.setdefault(key, {"account_head": tax.account_head, "rate": tax.rate, "amount": 0})
        row["amount"] += flt(tax.tax_amount)

    return {
        "invoices": [
            {
                "name": invoice.name,
                "customer": invoice.customer,
                "posting_date": invoice.posting_date,
                "grand_total": flt(invoice.grand_total),
            }
            for invoice in invoices
        ],
        "grand_total": sum(flt(invoice.grand_total) for invoice in invoices),
        "net_total": sum(flt(invoice.net_total) for invoice in invoices),
        "total_quantity": sum(flt(invoice.total_qty) for invoice in invoices),
        "sales_by_mode": sales_by_mode,
        "taxes": list(taxes.values()),
    }


def get_own_opening_entry(pos_opening_entry, for_update=False):
    """The open shift being closed, checked to belong to the caller.

    Locked when closing so a double tap, or a second tab, cannot close the
    same shift twice.
    """
    opening_entry = frappe.db.get_value(
        "POS Opening Entry",
        pos_opening_entry,
        ["name", "user", "pos_profile", "company", "period_start_date", "status", "docstatus"],
        as_dict=True,
        for_update=for_update,
    )
    if not opening_entry:
        frappe.throw(_("POS Opening Entry {0} not found.").format(pos_opening_entry), frappe.DoesNotExistError)

    user = frappe.session.user
    is_supervisor = user == "Administrator" or bool(set(frappe.get_roles(user)) & SUPERVISOR_ROLES)
    if opening_entry.user != user and not is_supervisor:
        frappe.throw(_("You can only close your own shift."), frappe.PermissionError)

    if opening_entry.docstatus != 1 or opening_entry.status != "Open":
        frappe.throw(_("This shift is already closed."), title=_("Shift Closed"))

    return opening_entry


def drafts_message(drafts):
    return _("Settle or cancel the open bills before closing the shift: {0}").format(", ".join(drafts))


@frappe.whitelist()
def get_shift_closing_summary(pos_opening_entry):
    """What closing this shift would attach, for the closing screen."""
    opening_entry = get_own_opening_entry(pos_opening_entry)
    end = now_datetime()
    submitted, drafts = get_shift_invoices(opening_entry, end)

    summary = summarize(submitted)
    summary["period_end_date"] = end
    summary["draft_invoices"] = drafts
    return summary


@frappe.whitelist(methods=["POST"])
def close_shift(pos_opening_entry, closing_amounts, invoice_names=None):
    """Create and submit the POS Closing Entry for a shift, with every POS
    Invoice of the shift attached.

    `closing_amounts` is the cashier's count, a list of
    ``{mode_of_payment, closing_amount}``. `invoice_names` is the list the
    closing screen showed; when bills were paid in the meantime the shift is
    not closed and the fresh summary is returned instead, so the cashier
    recounts against the real figures rather than closing on stale ones.
    """
    if isinstance(closing_amounts, str):
        closing_amounts = json.loads(closing_amounts)
    if isinstance(invoice_names, str):
        invoice_names = json.loads(invoice_names)

    opening_entry = get_own_opening_entry(pos_opening_entry, for_update=True)
    end = now_datetime()
    submitted, drafts = get_shift_invoices(opening_entry, end)

    if drafts:
        frappe.throw(drafts_message(drafts), title=_("Open Bills"))

    summary = summarize(submitted)
    if invoice_names is not None and set(invoice_names) != {invoice.name for invoice in submitted}:
        summary["period_end_date"] = end
        summary["draft_invoices"] = drafts
        return {"status": "invoices_changed", "summary": summary}

    counted = {
        row.get("mode_of_payment"): flt(row.get("closing_amount"))
        for row in closing_amounts or []
        if row.get("mode_of_payment")
    }
    multiple_cashier = frappe.db.get_value(
        "POS Profile", opening_entry.pos_profile, "custom_enable_multiple_cashier"
    )

    payment_reconciliation = []
    seen_modes = set()
    opening_balances = frappe.get_all(
        "POS Opening Entry Detail",
        filters={"parent": opening_entry.name, "parenttype": "POS Opening Entry"},
        fields=["mode_of_payment", "opening_amount"],
        order_by="idx",
    )
    for mode in [row.mode_of_payment for row in opening_balances] + list(summary["sales_by_mode"]) + list(counted):
        if mode in seen_modes:
            continue
        seen_modes.add(mode)
        opening_amount = sum(flt(row.opening_amount) for row in opening_balances if row.mode_of_payment == mode)
        # Expected is what the shift sold through this mode, as the closing
        # screen shows it next to the opening float.
        expected_amount = flt(summary["sales_by_mode"].get(mode))
        closing_amount = counted.get(mode, 0)
        row = {
            "mode_of_payment": mode,
            "opening_amount": opening_amount,
            "expected_amount": expected_amount,
            "closing_amount": closing_amount,
            "difference": closing_amount - expected_amount,
        }
        if multiple_cashier:
            # The main cashier's own count; the closing-entry hook adds the
            # sub cashiers' counts on top of it to get `closing_amount`.
            row["custom_closing_amount"] = closing_amount
        payment_reconciliation.append(row)

    closing_entry = frappe.get_doc(
        {
            "doctype": "POS Closing Entry",
            "pos_opening_entry": opening_entry.name,
            "pos_profile": opening_entry.pos_profile,
            "company": opening_entry.company,
            "user": opening_entry.user,
            "period_start_date": opening_entry.period_start_date,
            "period_end_date": end,
            "posting_date": end.date(),
            "posting_time": end.strftime("%H:%M:%S"),
            "grand_total": summary["grand_total"],
            "net_total": summary["net_total"],
            "total_quantity": summary["total_quantity"],
            "pos_transactions": [
                {
                    "pos_invoice": invoice["name"],
                    "posting_date": invoice["posting_date"],
                    "customer": invoice["customer"],
                    "grand_total": invoice["grand_total"],
                }
                for invoice in summary["invoices"]
            ],
            "payment_reconciliation": payment_reconciliation,
            "taxes": summary["taxes"],
        }
    )
    closing_entry.insert()
    closing_entry.submit()

    closing_entry.reload()
    return {
        "status": "closed",
        "name": closing_entry.name,
        # "Queued" when ERPNext consolidates in the background (10 invoices
        # or more); the entry turns "Submitted", or "Failed" with the reason
        # in `error_message`, once that job is done.
        "closing_status": closing_entry.status,
        "invoice_count": len(summary["invoices"]),
    }
