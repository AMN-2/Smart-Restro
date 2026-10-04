# Copyright (c) 2026, Smart Choice and contributors
# For license information, please see license.txt
"""QA Cat. 12: guest self-ordering trust boundary (SR-011).

Everything here is called exactly as an anonymous phone would: as Guest,
through the allow_guest functions in ury/ury/api/self_ordering.py.
"""

import base64
import hashlib
from unittest.mock import patch

import frappe
from frappe.utils import flt

from ury.tests.qa_base import QATestCase, RestaurantWorld

SO = "ury.ury.api.self_ordering"


def _token(profile, table, signature):
	raw = f"{profile}|{table}|{signature}"
	return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


class TestQASelfOrderingBoundary(QATestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.a = RestaurantWorld.build("A")
		cls.b = RestaurantWorld.build("B")
		cls.table = cls.a.tables[3]
		frappe.db.set_value("URY Table", cls.table, "enable_self_ordering", 1)
		cls.profile = "_QA Self Order A"
		if not frappe.db.exists("URY Self Ordering Profile", cls.profile):
			doc = frappe.get_doc(
				{
					"doctype": "URY Self Ordering Profile",
					"profile_name": cls.profile,
					"restaurant": cls.a.restaurant_name,
					"branch": cls.a.branch_name,
					"pos_profile": cls.a.profile_name,
					"default_customer": cls.a.customer,
					"enabled": 1,
					"enable_qr_table_ordering": 1,
					"allow_add_to_running_table": 1,
					"enable_item_notes": 1,
					"qr_signing_secret": frappe.generate_hash(length=32),
				}
			)
			doc.name = cls.profile
			doc.flags.name_set = True
			doc.insert(ignore_permissions=True)
		frappe.db.commit()

	def _guest(self, fn_name, **kwargs):
		fn = frappe.get_attr(f"{SO}.{fn_name}")
		frappe.set_user("Guest")
		try:
			return fn(**kwargs)
		finally:
			frappe.set_user("Administrator")

	def _valid_token(self, table=None):
		from ury.ury.api.self_ordering import generate_qr_token

		return generate_qr_token(self.profile, table or self.table)

	def _session(self):
		return self._guest("get_ordering_context", token=self._valid_token())["session"]

	# -- token ---------------------------------------------------------------

	def test_forged_signature_rejected(self):
		with self.assertRaises(frappe.PermissionError):
			self._guest("get_ordering_context", token=_token(self.profile, self.table, "0" * 64))

	def test_garbage_token_rejected(self):
		for t in ("", "not-base64!!", "YWJj", "x" * 5000):
			with self.assertRaises((frappe.PermissionError, frappe.ValidationError)):
				self._guest("get_ordering_context", token=t)

	def test_valid_signature_for_other_branch_table_rejected(self):
		with self.assertRaises((frappe.PermissionError, frappe.ValidationError)):
			self._guest("get_ordering_context", token=self._valid_token(self.b.tables[0]))

	def test_table_switched_off_rejected(self):
		frappe.db.set_value("URY Table", self.table, "enable_self_ordering", 0)
		try:
			with self.assertRaises(frappe.ValidationError):
				self._guest("get_ordering_context", token=self._valid_token())
		finally:
			frappe.db.set_value("URY Table", self.table, "enable_self_ordering", 1)

	def test_no_session_no_access(self):
		with self.assertRaises(frappe.PermissionError):
			self._guest("get_customer_order", session="0" * 64)

	# -- ordering ------------------------------------------------------------

	def test_off_menu_item_rejected(self):
		session = self._session()
		with self.assertRaises(frappe.ValidationError):
			self._guest(
				"add_customer_items",
				session=session,
				items=frappe.as_json([{"item": "_QA Not On Menu", "qty": 1}]),
			)

	def test_client_price_ignored(self):
		session = self._session()
		self._guest(
			"add_customer_items",
			session=session,
			items=frappe.as_json([{"item": "_QA Burger", "qty": 1, "rate": 1, "discount_percentage": 100}]),
		)
		token_hash = hashlib.sha256(session.encode()).hexdigest()
		inv = frappe.db.get_value("URY Ordering Session", {"token_hash": token_hash}, "invoice")
		self.assertTrue(inv, "guest order did not create an invoice")
		rate = frappe.db.get_value("POS Invoice Item", {"parent": inv, "item_code": "_QA Burger"}, "rate")
		self.assertEqual(flt(rate), 12000)

	def test_negative_and_huge_qty_rejected(self):
		session = self._session()
		for qty in (-1, 0, "abc"):
			with self.assertRaises(frappe.ValidationError, msg=f"qty={qty}"):
				self._guest(
					"add_customer_items",
					session=session,
					items=frappe.as_json([{"item": "_QA Tea", "qty": qty}]),
				)
		# NEEDS DECISION: is there a per-line quantity ceiling for guests? 10000 teas lands in the kitchen today.
		with self.assertRaises(frappe.ValidationError, msg="qty=10000 accepted from an anonymous guest"):
			self._guest(
				"add_customer_items",
				session=session,
				items=frappe.as_json([{"item": "_QA Tea", "qty": 10000}]),
			)

	def test_internal_error_text_not_returned_to_guest(self):
		session = self._session()
		secret = "INTERNAL-DETAIL /home/frappe/frappe-bench db=_abc123"
		with patch("frappe.model.document.Document.save", side_effect=Exception(secret)):
			try:
				self._guest(
					"add_customer_items",
					session=session,
					items=frappe.as_json([{"item": "_QA Tea", "qty": 1}]),
				)
			except Exception as e:
				self.assertNotIn(
					"INTERNAL-DETAIL", str(e), "SR-011: raw exception text sent to an anonymous guest"
				)
				return
		self.fail("expected the failed save to raise")

	# -- secret handling -----------------------------------------------------

	def test_qr_signing_secret_not_readable_by_cashier(self):
		frappe.set_user(self.a.users["cashier"])
		try:
			from frappe.client import get as client_get

			try:
				doc = client_get("URY Self Ordering Profile", self.profile)
			except frappe.PermissionError:
				return
			self.assertFalse(
				doc.get("qr_signing_secret"),
				"SR-011: a cashier can read the HMAC secret that signs every table's QR code",
			)
		finally:
			frappe.set_user("Administrator")
