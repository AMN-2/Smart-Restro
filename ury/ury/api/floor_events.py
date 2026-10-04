"""Live floor updates: one realtime event for every change to an order or a table.

Every screen that shows an order or a table — the waiter POS (`/urypos`), the
cashier POS and captain workspace (`/pos`), the management app (`/ury`) — has
to see a change made anywhere else without a manual reload: an item added from
another device, a table transferred, a bill printed, paid, cancelled or closed,
tables merged or split.

Design
------
*One event, published after commit.* Changes are collected for the duration of
the request and flushed once, after the transaction commits
(`frappe.db.after_commit`). A rolled-back request publishes nothing, and a
client that re-fetches on receipt always reads committed data. A request that
touches the same invoice five times (sync_order saves, sets the table, writes
the KOT…) still sends a single event.

*Notify, then re-fetch.* The payload names what changed — branch, invoices,
tables, why — and nothing else. Clients re-read through the normal,
permission-checked APIs, so the event never carries prices, items or customer
data, and a client that misses an event recovers on its next fetch.

*Permission-scoped room.* Published to the `doctype:POS Invoice` room, which
the socket server lets a user join only after checking read permission on
POS Invoice (`frappe.realtime.can_subscribe_doctype`). Users without access to
orders never receive table or invoice names.

Sources
-------
`doc_events` on POS Invoice and URY Table catch every ORM save, submit, cancel
and delete. Code paths that write with `frappe.db.set_value` (no doc events)
call `notify_floor_change` explicitly: table release, merge/unmerge, close
table, cancel order, and the print paths that set `invoice_printed`.
"""

import frappe
from frappe.realtime import get_doctype_room
from frappe.utils import now_datetime

FLOOR_EVENT = "ury_floor_update"
FLOOR_ROOM_DOCTYPE = "POS Invoice"

_PENDING_KEY = "ury_floor_events_pending"


def _publishing_disabled():
    flags = frappe.flags
    return bool(
        flags.in_install
        or flags.in_migrate
        or flags.in_patch
        or flags.in_import
        or flags.in_uninstall
        or getattr(flags, "ury_suppress_floor_events", False)
    )


def _split_tables(value):
    if not value:
        return []
    if isinstance(value, (list, tuple, set)):
        items = value
    else:
        items = str(value).split(",")
    return [str(t).strip() for t in items if t and str(t).strip()]


def notify_floor_change(invoices=None, tables=None, branch=None, reason=None):
    """Queue a floor update for this request; flushed once after commit.

    Never raises: realtime is a convenience on top of a write that has
    already succeeded, and it must not be able to fail that write.
    """
    try:
        if _publishing_disabled():
            return

        invoice_names = [i for i in (invoices if isinstance(invoices, (list, tuple, set)) else [invoices]) if i]
        table_names = _split_tables(tables)
        if not invoice_names and not table_names:
            return

        branches = set()
        if branch:
            branches.add(branch)
        else:
            for name in invoice_names:
                b = frappe.db.get_value("POS Invoice", name, "branch")
                if b:
                    branches.add(b)
            for name in table_names:
                b = frappe.db.get_value("URY Table", name, "branch")
                if b:
                    branches.add(b)
        if not branches:
            # Unknown branch: still tell everyone, clients treat it as "any".
            branches.add("")

        pending = getattr(frappe.local, _PENDING_KEY, None)
        if pending is None:
            pending = {}
            setattr(frappe.local, _PENDING_KEY, pending)
            frappe.db.after_commit.add(_flush)
            frappe.db.after_rollback.add(_discard)

        for b in branches:
            entry = pending.setdefault(b, {"invoices": set(), "tables": set(), "reasons": set()})
            entry["invoices"].update(invoice_names)
            entry["tables"].update(table_names)
            if reason:
                entry["reasons"].add(reason)
    except Exception:
        frappe.log_error(title="URY floor event not queued", message=frappe.get_traceback())


def _discard():
    if hasattr(frappe.local, _PENDING_KEY):
        delattr(frappe.local, _PENDING_KEY)


def _flush():
    pending = getattr(frappe.local, _PENDING_KEY, None)
    _discard()
    if not pending:
        return
    by = getattr(frappe.session, "user", None) if getattr(frappe.local, "session", None) else None
    at = now_datetime().isoformat()
    room = get_doctype_room(FLOOR_ROOM_DOCTYPE)
    for branch, entry in pending.items():
        try:
            frappe.publish_realtime(
                FLOOR_EVENT,
                {
                    "branch": branch or None,
                    "invoices": sorted(entry["invoices"]),
                    "tables": sorted(entry["tables"]),
                    "reasons": sorted(entry["reasons"]),
                    "by": by,
                    "at": at,
                },
                room=room,
            )
        except Exception:
            frappe.log_error(title="URY floor event not published", message=frappe.get_traceback())


# ---------------------------------------------------------------------------
# doc_events
# ---------------------------------------------------------------------------

def _invoice_reason(doc, method):
    if method == "on_submit":
        return "paid"
    if method in ("on_cancel", "on_trash"):
        return "cancelled"
    if method == "after_insert":
        return "created"
    return "updated"


def on_pos_invoice_change(doc, method=None):
    """POS Invoice: after_insert / on_update / on_submit / on_cancel / on_trash /
    on_update_after_submit."""
    tables = _split_tables(doc.get("restaurant_table")) + _split_tables(doc.get("custom_merged_tables"))
    before_save = getattr(doc, "get_doc_before_save", None)
    previous = before_save() if callable(before_save) else None
    if previous is not None and previous.get("restaurant_table") != doc.get("restaurant_table"):
        # A table transfer: the table the order left changed too.
        tables += _split_tables(previous.get("restaurant_table"))
        tables += _split_tables(previous.get("custom_merged_tables"))
    notify_floor_change(
        invoices=[doc.name],
        tables=tables,
        branch=doc.get("branch"),
        reason=_invoice_reason(doc, method),
    )


def on_ury_table_change(doc, method=None):
    """URY Table: after_insert / on_update / on_trash (desk edits, setup)."""
    notify_floor_change(
        tables=[doc.name] + _split_tables(doc.get("merged_with")),
        branch=doc.get("branch"),
        reason="table",
    )
