// Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

// The raw settings behind the URY Control Center, which is the page meant
// for editing them (per-feature switches, who keeps Desk, preview a user).
frappe.ui.form.on("URY Feature Settings", {
	refresh(frm) {
		frm.set_intro(
			__("Features turned off here are hidden from the dashboard and POS and refused by the server. The URY Control Center shows the same settings with each user's resulting access."),
			"blue"
		);
		frm.add_custom_button(__("URY Control Center"), () => frappe.set_route("ury-control-center"));
	},
});
