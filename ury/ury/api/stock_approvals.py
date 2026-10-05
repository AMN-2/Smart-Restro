"""Raw-material movements that wait for a manager before they touch stock.

The floor must not stop because a count is off: a sale whose ingredients
are "not in the kitchen" yet, or a transfer typed with the wrong unit, would
otherwise block the cashier or the storekeeper at the worst moment. So, with
the "stock_approval" feature on, the day's raw-material movements are only
saved as draft Stock Entries:

  * consumption - the Material Issue a sale's recipe makes
    (ury.ury.api.consumption), one per invoice;
  * transfer    - a Material Transfer between warehouses (main store to the
    kitchen or bar), entered by staff from this screen.

A draft never fails for missing stock. When the manager is free, the screen
lists the drafts day by day, with the materials they move and any shortage
that would stop them posting, and the manager approves them (submit) in one
go. Approving from the ERPNext desk works too: the Stock Entry hooks below
keep the consumption log in step either way.

Everything goes through the user's own permissions on Stock Entry: reading
the list needs read, a transfer needs create, approving needs submit.
"""

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, flt, getdate, nowdate, nowtime

from ury.ury.api.consumption import apply_rates

PURPOSES = ("Material Transfer", "Material Issue")
MAX_ENTRIES = 500
MAX_APPROVE_BATCH = 50
SEARCH_LIMIT = 20
# Where a sale's deduction lands if the stock it needs only arrived later the
# same day: still that day, after the transfers that fed it.
END_OF_DAY = "23:59:59"


# --------------------------------------------------------------------------- setup


@frappe.whitelist()
def get_setup(branch=None):
	"""Warehouses and defaults for the transfer form, and what this user may do."""
	frappe.has_permission("Stock Entry", "read", throw=True)
	company, store = _company_and_store(branch)
	warehouses = frappe.get_list(
		"Warehouse",
		filters={"company": company, "is_group": 0, "disabled": 0},
		fields=["name", "warehouse_name"],
		order_by="warehouse_name asc",
		limit_page_length=0,
	)
	names = {w.name for w in warehouses}
	if store not in names:
		store = warehouses[0].name if warehouses else None
	kitchens = [w for w in _production_warehouses(branch) if w in names and w != store]
	return {
		"company": company,
		"currency": frappe.get_cached_value("Company", company, "default_currency"),
		"warehouses": [{"name": w.name, "label": w.warehouse_name or w.name} for w in warehouses],
		"default_from": store,
		"default_to": kitchens[0] if kitchens else None,
		"today": nowdate(),
		"approval_on": _approval_on(),
		"permissions": {
			"create": bool(frappe.has_permission("Stock Entry", "create")),
			"approve": bool(frappe.has_permission("Stock Entry", "submit")),
			"delete": bool(frappe.has_permission("Stock Entry", "delete")),
		},
	}


@frappe.whitelist()
def search_materials(term=None, warehouse=None):
	"""Raw materials (stock items) to transfer, with what the source warehouse holds."""
	frappe.has_permission("Stock Entry", "read", throw=True)
	term = (term or "").strip()
	or_filters = None
	if term:
		like = f"%{term}%"
		or_filters = [["Item", "name", "like", like], ["Item", "item_name", "like", like]]
	items = frappe.get_list(
		"Item",
		filters={"disabled": 0, "is_stock_item": 1, "has_variants": 0, "is_fixed_asset": 0},
		or_filters=or_filters,
		fields=["name", "item_name", "item_group", "stock_uom"],
		order_by="item_name asc",
		limit_page_length=SEARCH_LIMIT,
	)
	if not items:
		return []
	codes = [i.name for i in items]
	uoms = {}
	for row in frappe.get_all(
		"UOM Conversion Detail",
		filters={"parent": ["in", codes], "parenttype": "Item"},
		fields=["parent", "uom", "conversion_factor"],
		order_by="idx asc",
	):
		uoms.setdefault(row.parent, []).append({"uom": row.uom, "conversion_factor": flt(row.conversion_factor)})
	stock = _bin_qty(codes, [warehouse]) if warehouse else {}
	out = []
	for i in items:
		options = uoms.get(i.name) or []
		if not any(u["uom"] == i.stock_uom for u in options):
			options.insert(0, {"uom": i.stock_uom, "conversion_factor": 1.0})
		out.append({
			"item_code": i.name,
			"item_name": i.item_name,
			"item_group": i.item_group,
			"stock_uom": i.stock_uom,
			"uoms": options,
			"available_qty": flt(stock.get((i.name, warehouse))) if warehouse else None,
		})
	return out


# --------------------------------------------------------------------------- transfer


@frappe.whitelist(methods=["POST"])
def create_transfer(data):
	"""Save a raw-material transfer between two warehouses as a draft."""
	frappe.has_permission("Stock Entry", "create", throw=True)
	data = frappe.parse_json(data) if isinstance(data, str) else frappe._dict(data or {})
	source, target = data.get("from_warehouse"), data.get("to_warehouse")
	if not source or not target:
		frappe.throw(_("Choose the warehouse the materials leave and the one they go to"))
	if source == target:
		frappe.throw(_("The two warehouses must be different"))
	company = frappe.db.get_value("Warehouse", source, "company")
	if company != frappe.db.get_value("Warehouse", target, "company"):
		frappe.throw(_("Both warehouses must belong to the same company"))

	lines = [r for r in (data.get("items") or []) if r.get("item_code") and flt(r.get("qty")) > 0]
	if not lines:
		frappe.throw(_("Add at least one material with a quantity"))

	se = frappe.new_doc("Stock Entry")
	se.stock_entry_type = "Material Transfer"
	se.purpose = "Material Transfer"
	se.company = company
	se.from_warehouse = source
	se.to_warehouse = target
	# Pinned: an unpinned draft would post on the day it is approved, not the
	# day the materials moved.
	se.set_posting_time = 1
	se.posting_date = getdate(data.get("posting_date") or nowdate())
	se.posting_time = nowtime()
	se.remarks = (data.get("remarks") or "").strip() or _("Raw-material transfer")
	for line in lines:
		item_code = line.get("item_code")
		if not cint(frappe.get_cached_value("Item", item_code, "is_stock_item")):
			frappe.throw(_("{0} is not a stock item").format(item_code))
		stock_uom = frappe.get_cached_value("Item", item_code, "stock_uom")
		uom = line.get("uom") or stock_uom
		factor = 1.0 if uom == stock_uom else _conversion_factor(item_code, uom)
		se.append("items", {
			"item_code": item_code,
			"s_warehouse": source,
			"t_warehouse": target,
			"qty": flt(line.get("qty")),
			"uom": uom,
			"stock_uom": stock_uom,
			"conversion_factor": factor,
		})
	se.insert()
	return {"name": se.name}


# --------------------------------------------------------------------------- list


@frappe.whitelist()
def get_drafts(branch=None, from_date=None, to_date=None):
	"""The draft raw-material movements of a period, day by day, with their shortages."""
	frappe.has_permission("Stock Entry", "read", throw=True)
	to_date = getdate(to_date or nowdate())
	from_date = getdate(from_date or add_to_date(to_date, days=-6))
	company = _branch_company(branch)

	filters = {
		"docstatus": 0,
		"purpose": ["in", PURPOSES],
		"posting_date": ["between", [from_date, to_date]],
	}
	if company:
		filters["company"] = company
	entries = frappe.get_list(
		"Stock Entry",
		filters=filters,
		fields=["name", "purpose", "posting_date", "posting_time", "owner", "remarks", "company", "total_outgoing_value"],
		order_by="posting_date asc, posting_time asc, creation asc",
		limit_page_length=MAX_ENTRIES + 1,
	)
	truncated = len(entries) > MAX_ENTRIES
	entries = entries[:MAX_ENTRIES]
	# Drafts older than the window are the ones most likely forgotten.
	older_filters = {**filters, "posting_date": ["<", from_date]}
	older = frappe.db.count("Stock Entry", older_filters)
	if not entries:
		return _result(from_date, to_date, [], [], truncated, older)

	names = [e.name for e in entries]
	logs = {
		r.stock_entry: r
		for r in frappe.get_all(
			"URY Consumption Log",
			filters={"stock_entry": ["in", names]},
			fields=["name", "stock_entry", "pos_invoice", "branch"],
		)
	}
	if branch and branch != "all":
		# A sale's deduction belongs to its branch; a transfer to the company.
		entries = [e for e in entries if e.name not in logs or logs[e.name].branch == branch]
		names = [e.name for e in entries]

	rows = frappe.get_all(
		"Stock Entry Detail",
		filters={"parent": ["in", names], "parenttype": "Stock Entry"},
		fields=["parent", "item_code", "item_name", "qty", "uom", "transfer_qty", "stock_uom",
				"s_warehouse", "t_warehouse", "basic_amount"],
		order_by="idx asc",
	)
	by_entry = {}
	for r in rows:
		by_entry.setdefault(r.parent, []).append(r)

	# Will it post? Stock on hand, plus what pending transfers bring in,
	# minus everything the drafts take out.
	pairs = {(r.item_code, w) for r in rows for w in (r.s_warehouse, r.t_warehouse) if w}
	on_hand = _bin_qty({p[0] for p in pairs}, {p[1] for p in pairs})
	balance = {p: flt(on_hand.get(p)) for p in pairs}
	for r in rows:
		if r.s_warehouse:
			balance[(r.item_code, r.s_warehouse)] -= flt(r.transfer_qty)
		if r.t_warehouse:
			balance[(r.item_code, r.t_warehouse)] += flt(r.transfer_qty)
	short = {p for p, qty in balance.items() if qty < -1e-9}

	users = _user_names({e.owner for e in entries})
	out = []
	for e in entries:
		items = by_entry.get(e.name, [])
		log = logs.get(e.name)
		short_items = sorted({r.item_name or r.item_code for r in items if (r.item_code, r.s_warehouse) in short})
		out.append({
			"name": e.name,
			"kind": "consumption" if log else ("transfer" if e.purpose == "Material Transfer" else "issue"),
			"purpose": e.purpose,
			"posting_date": e.posting_date,
			"posting_time": str(e.posting_time or "")[:5],
			"owner": e.owner,
			"owner_name": users.get(e.owner) or e.owner,
			"remarks": e.remarks,
			"pos_invoice": log.pos_invoice if log else None,
			"from_warehouses": sorted({r.s_warehouse for r in items if r.s_warehouse}),
			"to_warehouses": sorted({r.t_warehouse for r in items if r.t_warehouse}),
			"value": flt(e.total_outgoing_value) or sum(flt(r.basic_amount) for r in items),
			"short_items": short_items,
			"items": [
				{
					"item_code": r.item_code,
					"item_name": r.item_name,
					"qty": flt(r.qty),
					"uom": r.uom,
					"s_warehouse": r.s_warehouse,
					"t_warehouse": r.t_warehouse,
					"short": (r.item_code, r.s_warehouse) in short,
				}
				for r in items
			],
		})

	materials = {}
	for r in rows:
		key = (r.item_code, r.s_warehouse or r.t_warehouse)
		m = materials.setdefault(key, {
			"item_code": r.item_code,
			"item_name": r.item_name,
			"stock_uom": r.stock_uom,
			"warehouse": key[1],
			"out_qty": 0.0,
			"in_qty": 0.0,
		})
		if r.s_warehouse:
			m["out_qty"] += flt(r.transfer_qty)
		if r.t_warehouse:
			# Received into the target; shown on the target's own row.
			t = materials.setdefault((r.item_code, r.t_warehouse), {
				"item_code": r.item_code, "item_name": r.item_name, "stock_uom": r.stock_uom,
				"warehouse": r.t_warehouse, "out_qty": 0.0, "in_qty": 0.0,
			})
			t["in_qty"] += flt(r.transfer_qty)
	for key, m in materials.items():
		m["on_hand"] = flt(on_hand.get(key))
		m["after"] = flt(balance.get(key))
		m["short"] = key in short
	material_rows = sorted(materials.values(), key=lambda m: (not m["short"], m["item_name"] or "", m["warehouse"] or ""))
	return _result(from_date, to_date, out, material_rows, truncated, older)


def _result(from_date, to_date, entries, materials, truncated, older):
	return {
		"from_date": from_date,
		"to_date": to_date,
		"today": nowdate(),
		"entries": entries,
		"materials": materials,
		"truncated": truncated,
		"older_count": older,
		"approval_on": _approval_on(),
	}


# --------------------------------------------------------------------------- approve


@frappe.whitelist(methods=["POST"])
def approve(names):
	"""Post these drafts, oldest first. Each succeeds or fails on its own."""
	frappe.has_permission("Stock Entry", "submit", throw=True)
	names = frappe.parse_json(names) if isinstance(names, str) else names
	names = list(dict.fromkeys(names or []))
	if len(names) > MAX_APPROVE_BATCH:
		frappe.throw(_("Approve at most {0} at a time").format(MAX_APPROVE_BATCH))

	entries = frappe.get_all(
		"Stock Entry",
		filters={"name": ["in", names]},
		fields=["name", "docstatus", "purpose", "posting_date", "posting_time"],
	)
	# Transfers before the issues of the same day: the kitchen is stocked
	# before it is drawn from.
	entries.sort(key=lambda e: (e.posting_date, e.purpose != "Material Transfer", str(e.posting_time)))
	results = []
	for e in entries:
		if e.docstatus != 0:
			results.append({"name": e.name, "ok": e.docstatus == 1, "error": None if e.docstatus == 1 else _("Cancelled")})
			continue
		results.append(_approve_one(e.name))
	missing = set(names) - {e.name for e in entries}
	results.extend({"name": n, "ok": False, "error": _("Not found")} for n in missing)
	return {
		"approved": sum(1 for r in results if r["ok"]),
		"failed": sum(1 for r in results if not r["ok"]),
		"results": results,
	}


def _approve_one(name):
	frappe.db.savepoint("ury_stock_approval")
	try:
		se = frappe.get_doc("Stock Entry", name)
		try:
			se.submit()
		except frappe.ValidationError:
			if not _is_consumption(name):
				raise
			# A sale's deduction can precede, by the clock, the transfer that
			# stocked the kitchen that day. Same day, after that transfer.
			frappe.db.rollback(save_point="ury_stock_approval")
			frappe.local.message_log = []
			se = frappe.get_doc("Stock Entry", name)
			se.set_posting_time = 1
			se.posting_time = END_OF_DAY
			se.submit()
		return {"name": name, "ok": True, "error": None}
	except Exception as e:
		frappe.db.rollback(save_point="ury_stock_approval")
		return {"name": name, "ok": False, "error": _clean_error(e)}


# --------------------------------------------------------------------------- reject


@frappe.whitelist(methods=["POST"])
def delete_drafts(names):
	"""Throw away draft transfers entered by mistake. A sale's deduction is not
	deleted here: it follows its invoice, and goes when the sale is cancelled."""
	frappe.has_permission("Stock Entry", "delete", throw=True)
	names = frappe.parse_json(names) if isinstance(names, str) else names
	deleted, refused = [], []
	for name in names or []:
		if _is_consumption(name) or frappe.db.get_value("Stock Entry", name, "docstatus") != 0:
			refused.append(name)
			continue
		frappe.delete_doc("Stock Entry", name)
		deleted.append(name)
	return {"deleted": deleted, "refused": refused}


# --------------------------------------------------------------------------- hooks


def on_stock_entry_submit(doc, method=None):
	"""A sale's deduction approved (here or in the desk): its log is done, at posted rates."""
	name = frappe.db.get_value("URY Consumption Log", {"stock_entry": doc.name, "status": "Draft"}, "name")
	if not name:
		return
	log = frappe.get_doc("URY Consumption Log", name)
	apply_rates(log, doc)
	log.status = "Done"
	log.error = None
	log.save(ignore_permissions=True)


def on_stock_entry_trash(doc, method=None):
	"""A sale's draft deduction deleted in the desk: the sale consumed nothing on record."""
	name = frappe.db.get_value("URY Consumption Log", {"stock_entry": doc.name}, "name")
	if not name:
		return
	frappe.db.set_value(
		"URY Consumption Log", name,
		{"stock_entry": None, "status": "Cancelled", "error": _("Draft deduction {0} was deleted").format(doc.name)},
	)


# --------------------------------------------------------------------------- helpers


def _approval_on():
	from ury.ury.api.consumption import needs_approval

	return needs_approval()


def _is_consumption(stock_entry):
	return bool(frappe.db.exists("URY Consumption Log", {"stock_entry": stock_entry}))


def _branch_company(branch):
	if not branch or branch == "all":
		return None
	return frappe.db.get_value("POS Profile", {"branch": branch, "disabled": 0}, "company")


def _company_and_store(branch):
	"""The branch's company and the warehouse its stock is kept in."""
	from ury.ury.api.purchases import _company_and_warehouse

	return _company_and_warehouse(branch)


def _production_warehouses(branch):
	"""Kitchen, bar, hookah station…: where materials are transferred to."""
	filters = {"warehouse": ["is", "set"]}
	if branch and branch != "all":
		filters["branch"] = branch
	return list(dict.fromkeys(frappe.get_all("URY Production Unit", filters=filters, pluck="warehouse")))


def _bin_qty(item_codes, warehouses):
	item_codes, warehouses = list(item_codes), [w for w in warehouses if w]
	if not item_codes or not warehouses:
		return {}
	return {
		(r.item_code, r.warehouse): flt(r.actual_qty)
		for r in frappe.get_all(
			"Bin",
			filters={"item_code": ["in", item_codes], "warehouse": ["in", warehouses]},
			fields=["item_code", "warehouse", "actual_qty"],
		)
	}


def _conversion_factor(item_code, uom):
	factor = frappe.db.get_value(
		"UOM Conversion Detail", {"parent": item_code, "parenttype": "Item", "uom": uom}, "conversion_factor"
	)
	if not factor:
		frappe.throw(_("{0} has no conversion for the unit {1}").format(item_code, uom))
	return flt(factor)


def _user_names(users):
	if not users:
		return {}
	return dict(frappe.get_all("User", filters={"name": ["in", list(users)]}, fields=["name", "full_name"], as_list=True))


def _clean_error(e):
	from ury.ury.api.consumption import _clean_error as clean

	return clean(e)
