"""Live floor updates (floor_events.py): one event per branch, after commit only."""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from ury.ury.api import floor_events as fe


class TestFloorEvents(FrappeTestCase):
    def setUp(self):
        self.sent = []
        patcher = patch.object(
            fe.frappe,
            "publish_realtime",
            side_effect=lambda event, message=None, room=None, **kw: self.sent.append((event, message, room)),
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_publishes_once_per_branch_after_commit(self):
        fe.notify_floor_change(invoices=["INV-1"], tables=["T1"], branch="B1", reason="updated")
        fe.notify_floor_change(invoices=["INV-1", "INV-2"], tables="T2, T1", branch="B1", reason="printed")
        fe.notify_floor_change(tables=["X9"], branch="B2", reason="released")
        self.assertEqual(self.sent, [])

        frappe.db.commit()

        self.assertEqual(len(self.sent), 2)
        by_branch = {m["branch"]: (e, m, r) for e, m, r in self.sent}
        event, message, room = by_branch["B1"]
        self.assertEqual(event, fe.FLOOR_EVENT)
        self.assertEqual(room, "doctype:POS Invoice")
        self.assertEqual(message["invoices"], ["INV-1", "INV-2"])
        self.assertEqual(message["tables"], ["T1", "T2"])
        self.assertEqual(message["reasons"], ["printed", "updated"])
        self.assertEqual(by_branch["B2"][1]["tables"], ["X9"])

    def test_rollback_publishes_nothing(self):
        fe.notify_floor_change(invoices=["INV-3"], branch="B1")
        frappe.db.rollback()
        frappe.db.commit()
        self.assertEqual(self.sent, [])

    def test_transfer_includes_the_table_left_behind(self):
        doc = frappe._dict(name="INV-9", restaurant_table="NEW", custom_merged_tables="M1,M2", branch="B1")
        doc.get_doc_before_save = lambda: frappe._dict(restaurant_table="OLD", custom_merged_tables="")
        fe.on_pos_invoice_change(doc, "on_update")
        frappe.db.commit()
        self.assertEqual(self.sent[0][1]["tables"], ["M1", "M2", "NEW", "OLD"])

    def test_reason_follows_the_document_event(self):
        doc = frappe._dict(name="INV-5", restaurant_table="T5", custom_merged_tables=None, branch="B1")
        fe.on_pos_invoice_change(doc, "on_submit")
        frappe.db.commit()
        self.assertEqual(self.sent[0][1]["reasons"], ["paid"])

    def test_suppressed_during_migrate(self):
        frappe.flags.in_migrate = True
        try:
            fe.notify_floor_change(invoices=["INV-4"], branch="B1")
            frappe.db.commit()
        finally:
            frappe.flags.in_migrate = False
        self.assertEqual(self.sent, [])

    def test_never_raises_on_empty_input(self):
        fe.notify_floor_change(invoices=[None], tables=None)
        fe.notify_floor_change()
        frappe.db.commit()
        self.assertEqual(self.sent, [])
