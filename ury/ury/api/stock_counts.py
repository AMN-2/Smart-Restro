"""Counting a warehouse, and correcting the books only with a manager's approval.

Staff count the shelves against a sheet of what the system expects. The
expected figure is the posted balance adjusted by the drafts still waiting
for approval (ury.ury.api.stock_approvals), since those materials have
already left the shelf. Where the count differs, the lines are saved as a
draft Stock Reconciliation, and the managers are notified that a correction
waits for them. Nothing changes in stock until a manager approves it here
(submit); a manager can also reject it, with a reason sent back to whoever
counted.

A reconciliation sets an absolute quantity at the moment of the count, so a
draft sale deduction from before that moment, approved later, is absorbed
by the count rather than taken twice.

Counting needs permission to record stock movements (Stock Entry or Stock
Reconciliation create); approving and rejecting need submit on Stock
Reconciliation.
"""

import frappe
from frappe import _
from frappe.utils import flt, nowdate, nowtime

from ury.ury.api.stock_reports import _raw_materials

TOLERANCE = 1e-6
SHEET_LIMIT = 1000


# --------------------------------------------------------------------------- sheet


@frappe.whitelist()
def get_count_sheet(warehouse, item_group=None, raw_only=1):
	"""What the system expects on the shelves of one warehouse."""
	_check_can_count()
	if frappe.db.get_value("Warehouse", warehouse, "is_group") != 0:
		frappe.throw(_("Choose a single warehouse to count"))
	raw = _raw_materials() if flt(raw_only) else None

	filters = {"disabled": 0, "is_stock_item": 1, "has_variants": 0}
	if item_group:
		filters["item_group"] = item_group
	# Raw materials: every ingredient, held or not, since "none left" is a
	# count too. Otherwise whatever the warehouse holds.
	codes = raw if raw is not None else set(
		frappe.get_all("Bin", filters={"warehouse": warehouse, "actual_qty": ["!=", 0]}, pluck="item_code")
	)
	items = frappe.get_all(
		"Item",
		filters={**filters, "name": ["in", list(codes) or [""]]},
		fields=["name", "item_name", "item_group", "stock_uom", "valuation_rate"],
		order_by="item_group asc, item_name asc",
		limit_page_length=SHEET_LIMIT,
	)
	bins = {
		b.item_code: b
		for b in frappe.get_all("Bin", filters={"warehouse": warehouse, "item_code": ["in", [i.name for i in items] or [""]]},
								fields=["item_code", "actual_qty", "valuation_rate"])
	}
	pending = _pending_net(warehouse)
	open_count = _open_count_for(warehouse)
	return {
		"warehouse": warehouse,
		"today": nowdate(),
		"open_count": open_count,
		"item_groups": sorted({i.item_group for i in items if i.item_group}),
		"rows": [
			{
				"item_code": i.name,
				"item_name": i.item_name,
				"item_group": i.item_group,
				"stock_uom": i.stock_uom,
				"system_qty": flt((bins.get(i.name) or {}).get("actual_qty")),
				"pending_qty": flt(pending.get(i.name)),
				"expected_qty": flt((bins.get(i.name) or {}).get("actual_qty")) + flt(pending.get(i.name)),
				"valuation_rate": flt((bins.get(i.name) or {}).get("valuation_rate")) or flt(i.valuation_rate),
			}
			for i in items
		],
	}


@frappe.whitelist(methods=["POST"])
def submit_count(warehouse, lines, remarks=None):
	"""Save the differences as a draft reconciliation and ask the managers to approve it."""
	_check_can_count()
	lines = frappe.parse_json(lines) if isinstance(lines, str) else lines
	company = frappe.db.get_value("Warehouse", warehouse, "company")
	if not company:
		frappe.throw(_("Warehouse {0} not found").format(warehouse))
	if _open_count_for(warehouse):
		frappe.throw(_("A count of {0} is already waiting for approval. Approve or reject it first.").format(warehouse))

	pending = _pending_net(warehouse)
	bins = {
		b.item_code: b
		for b in frappe.get_all("Bin", filters={"warehouse": warehouse}, fields=["item_code", "actual_qty", "valuation_rate"])
	}
	doc = frappe.new_doc("Stock Reconciliation")
	doc.company = company
	doc.purpose = "Stock Reconciliation"
	doc.set_posting_time = 1
	doc.posting_date = nowdate()
	doc.posting_time = nowtime()
	doc.set_warehouse = warehouse

	for line in lines or []:
		if line.get("counted_qty") in (None, ""):
			continue
		code = line.get("item_code")
		counted = flt(line.get("counted_qty"))
		if counted < 0:
			frappe.throw(_("The count of {0} cannot be negative").format(code))
		b = bins.get(code) or {}
		expected = flt(b.get("actual_qty")) + flt(pending.get(code))
		if abs(counted - expected) <= TOLERANCE:
			continue
		rate = flt(b.get("valuation_rate")) or flt(frappe.get_cached_value("Item", code, "valuation_rate")) or flt(
			frappe.get_cached_value("Item", code, "last_purchase_rate")
		)
		doc.append("items", {
			"item_code": code,
			"warehouse": warehouse,
			"qty": counted,
			"valuation_rate": rate,
		})
	if not doc.items:
		return {"name": None, "differences": 0}

	doc.flags.ignore_permissions = True
	doc.insert(ignore_permissions=True)
	# The doctype has no remarks field: the counter's note travels as a comment.
	if (remarks or "").strip():
		doc.add_comment("Comment", frappe.utils.escape_html(remarks.strip()))
	_notify(_approvers(exclude=frappe.session.user), doc,
			_("Stock count of {0} waits for your approval ({1} corrections)").format(warehouse, len(doc.items)))
	return {"name": doc.name, "differences": len(doc.items)}


# --------------------------------------------------------------------------- review


@frappe.whitelist()
def get_counts(branch=None):
	"""Counts waiting for approval, with each difference against today's expected figure."""
	if not (_can_count() or frappe.has_permission("Stock Reconciliation", "read")):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	filters = {"docstatus": 0, "purpose": "Stock Reconciliation"}
	company = _branch_company(branch)
	if company:
		filters["company"] = company
	docs = frappe.get_all(
		"Stock Reconciliation",
		filters=filters,
		fields=["name", "posting_date", "posting_time", "owner", "set_warehouse", "creation"],
		order_by="creation desc",
		limit_page_length=100,
	)
	if not docs:
		return {"counts": [], "can_approve": _can_approve()}
	items = {}
	for r in frappe.get_all(
		"Stock Reconciliation Item",
		filters={"parent": ["in", [d.name for d in docs]]},
		fields=["parent", "item_code", "item_name", "warehouse", "qty", "valuation_rate"],
		order_by="idx asc",
	):
		items.setdefault(r.parent, []).append(r)
	users = dict(frappe.get_all("User", filters={"name": ["in", list({d.owner for d in docs})]},
								fields=["name", "full_name"], as_list=True))
	notes = {}
	for c in frappe.get_all(
		"Comment",
		filters={"reference_doctype": "Stock Reconciliation", "reference_name": ["in", [d.name for d in docs]],
				 "comment_type": "Comment"},
		fields=["reference_name", "content"],
		order_by="creation asc",
	):
		notes[c.reference_name] = frappe.utils.strip_html(c.content or "")
	out = []
	for d in docs:
		lines = items.get(d.name, [])
		pending_by_wh = {}
		rows = []
		value = 0.0
		for r in lines:
			pending = pending_by_wh.setdefault(r.warehouse, _pending_net(r.warehouse))
			system = flt(frappe.db.get_value("Bin", {"item_code": r.item_code, "warehouse": r.warehouse}, "actual_qty"))
			expected = system + flt(pending.get(r.item_code))
			diff = flt(r.qty) - expected
			value += diff * flt(r.valuation_rate)
			rows.append({
				"item_code": r.item_code,
				"item_name": r.item_name or r.item_code,
				"stock_uom": frappe.get_cached_value("Item", r.item_code, "stock_uom"),
				"warehouse": r.warehouse,
				"counted_qty": flt(r.qty),
				"expected_qty": expected,
				"difference": diff,
				"valuation_rate": flt(r.valuation_rate),
			})
		out.append({
			"name": d.name,
			"warehouse": d.set_warehouse or (lines[0].warehouse if lines else None),
			"posting_date": d.posting_date,
			"posting_time": str(d.posting_time or "")[:5],
			"owner": d.owner,
			"owner_name": users.get(d.owner) or d.owner,
			"remarks": notes.get(d.name),
			"value_difference": value,
			"rows": rows,
		})
	return {"counts": out, "can_approve": _can_approve()}


@frappe.whitelist(methods=["POST"])
def approve_count(name):
	"""Post the correction: stock takes the counted quantities, at the time of the count."""
	frappe.has_permission("Stock Reconciliation", "submit", throw=True)
	doc = frappe.get_doc("Stock Reconciliation", name)
	if doc.docstatus != 0:
		frappe.throw(_("{0} is no longer waiting for approval").format(name))
	doc.submit()
	_notify([doc.owner], doc, _("Your stock count {0} was approved").format(name))
	return {"name": name, "status": "approved"}


@frappe.whitelist(methods=["POST"])
def reject_count(name, reason=None):
	"""Throw the count away, telling whoever made it why."""
	frappe.has_permission("Stock Reconciliation", "submit", throw=True)
	doc = frappe.get_doc("Stock Reconciliation", name)
	if doc.docstatus != 0:
		frappe.throw(_("{0} is no longer waiting for approval").format(name))
	owner, warehouse = doc.owner, doc.set_warehouse
	reason = (reason or "").strip()
	frappe.delete_doc("Stock Reconciliation", name, ignore_permissions=True)
	if owner != frappe.session.user:
		frappe.get_doc({
			"doctype": "Notification Log",
			"for_user": owner,
			"from_user": frappe.session.user,
			"type": "Alert",
			"subject": _("Your stock count of {0} was rejected").format(warehouse)
			+ (f": {frappe.utils.escape_html(reason)}" if reason else ""),
		}).insert(ignore_permissions=True)
	return {"name": name, "status": "rejected"}


# --------------------------------------------------------------------------- helpers


def _can_count():
	return bool(frappe.has_permission("Stock Entry", "create") or frappe.has_permission("Stock Reconciliation", "create"))


def _check_can_count():
	if not _can_count():
		frappe.throw(_("You are not allowed to count stock"), frappe.PermissionError)


def _can_approve():
	return bool(frappe.has_permission("Stock Reconciliation", "submit"))


def _pending_net(warehouse):
	"""Net draft movement per item for one warehouse (out negative)."""
	return dict(frappe.db.sql(
		"""select item_code, sum(qty) from (
			select d.item_code, -d.transfer_qty as qty
			from `tabStock Entry Detail` d join `tabStock Entry` se on se.name = d.parent
			where se.docstatus = 0 and d.s_warehouse = %(wh)s
			union all
			select d.item_code, d.transfer_qty as qty
			from `tabStock Entry Detail` d join `tabStock Entry` se on se.name = d.parent
			where se.docstatus = 0 and d.t_warehouse = %(wh)s
		) x group by item_code""",
		{"wh": warehouse},
	))


def _open_count_for(warehouse):
	return frappe.db.get_value(
		"Stock Reconciliation", {"docstatus": 0, "purpose": "Stock Reconciliation", "set_warehouse": warehouse}, "name"
	)


def _approvers(exclude=None):
	from frappe.permissions import get_doctype_roles

	roles = [r for r in get_doctype_roles("Stock Reconciliation", "submit") if r not in ("Administrator",)]
	users = frappe.get_all(
		"Has Role",
		filters={"role": ["in", roles], "parenttype": "User"},
		pluck="parent",
		distinct=True,
	)
	enabled = set(frappe.get_all("User", filters={"name": ["in", users or [""]], "enabled": 1, "user_type": "System User"}, pluck="name"))
	return [u for u in enabled if u not in (exclude, "Guest")]


def _notify(users, doc, subject):
	if not users:
		return
	from frappe.desk.doctype.notification_log.notification_log import enqueue_create_notification

	enqueue_create_notification(users, {
		"type": "Alert",
		"document_type": doc.doctype,
		"document_name": doc.name,
		"subject": subject,
		"from_user": frappe.session.user,
		"email_content": subject,
	})


def _branch_company(branch):
	if not branch or branch == "all":
		return None
	return frappe.db.get_value("POS Profile", {"branch": branch, "disabled": 0}, "company")

