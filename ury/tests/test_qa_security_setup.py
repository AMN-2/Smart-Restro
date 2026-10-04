# Copyright (c) 2026, Smart Choice and contributors
# For license information, please see license.txt
"""QA Cat. 12: setup endpoints (SR-001, SR-002).

ury/ury/api/minimal/business_setup.py:create_setup_user has no role check and
inserts a System User with a caller-chosen role and password using
ignore_permissions=True. Frappe adds no guard of its own in that case
(frappe/core/doctype/user/user.py:validate). If these tests fail, any
logged-in user can mint a System Manager.

Every user these tests might create is deleted in tearDown.
"""

import frappe

from ury.tests.qa_base import QATestCase, RestaurantWorld, make_user

ESCALATED = "qa_escalated_user@example.com"


class TestQASetupEndpointsAuthz(QATestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.w = RestaurantWorld.build("A")
		cls.outsider = make_user(
			"qa_outsider@example.com", ["Blogger"]
		).name  # System User, no restaurant role

	def tearDown(self):
		frappe.set_user("Administrator")
		if frappe.db.exists("User", ESCALATED):
			frappe.delete_doc("User", ESCALATED, ignore_permissions=True, force=True)
		frappe.db.commit()
		super().tearDown()

	def _call_as(self, user, fn, **kwargs):
		frappe.set_user(user)
		try:
			return fn(**kwargs)
		finally:
			frappe.set_user("Administrator")

	def test_cashier_cannot_create_a_system_manager(self):
		from ury.ury.api.minimal.business_setup import create_setup_user

		with self.assertRaises(frappe.PermissionError):
			self._call_as(
				self.w.users["cashier"],
				create_setup_user,
				email=ESCALATED,
				name="QA Escalated",
				password="QA-Escalated-2026!",
				role="System Manager",
			)
		self.assertFalse(
			"System Manager" in frappe.get_roles(ESCALATED) if frappe.db.exists("User", ESCALATED) else False,
			"SR-001: a cashier created a System Manager",
		)

	def test_captain_cannot_create_any_user(self):
		from ury.ury.api.minimal.business_setup import create_setup_user

		with self.assertRaises(frappe.PermissionError):
			self._call_as(
				self.w.users["captain"], create_setup_user, email=ESCALATED, name="QA", role="URY Cashier"
			)

	def test_user_without_restaurant_role_cannot_create_user(self):
		from ury.ury.api.minimal.business_setup import create_setup_user

		with self.assertRaises(frappe.PermissionError):
			self._call_as(self.outsider, create_setup_user, email=ESCALATED, name="QA", role="System Manager")

	def test_cashier_cannot_change_company_tax_id(self):
		from ury.ury.api.minimal.business_setup import update_business_setup

		company = self.w.company
		before = frappe.db.get_value("Company", company, "tax_id")
		try:
			self._call_as(
				self.w.users["cashier"],
				update_business_setup,
				branch=frappe.as_json({"name": self.w.branch_name, "tax_id": "QA-TAMPERED"}),
			)
		except frappe.PermissionError:
			pass
		after = frappe.db.get_value("Company", company, "tax_id")
		frappe.db.set_value("Company", company, "tax_id", before)
		self.assertEqual(after, before, "SR-002: a cashier changed the company tax ID")

	def test_cashier_cannot_run_configure(self):
		from ury.ury.api.minimal.business_setup import submit_configure_data

		with self.assertRaises(frappe.PermissionError):
			self._call_as(self.w.users["cashier"], submit_configure_data, data=frappe.as_json({}))
