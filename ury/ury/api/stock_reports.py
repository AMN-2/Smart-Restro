"""The day's raw materials, from the opening balance to what is left after closing.

For one day and one warehouse (or all of them), every material that moved or
is held: what the day opened with, where it came from (purchases, transfers
in), where it went (consumed by sales through recipes, transfers out, waste,
direct sales of stocked items), the count corrections, and what was left at
the end of the day.

With stock approval on, part of the day is still in drafts. Those are not in
the ledger, so the posted closing balance overstates what is on the shelf;
the "after pending" column takes the drafts up to that day into account, and
is the figure to compare with a physical count.

Read access follows the user's permission on Stock Ledger Entry.
"""

import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate

# A movement's column in the report.
CATEGORIES = (
	"purchase", "transfer_in", "transfer_out", "sale_consumption",
	"direct_sale", "waste", "adjustment", "other",
)


@frappe.whitelist()
def get_daily_stock_report(date=None, branch=None, warehouse=None, raw_only=1):
	"""Opening, movements by kind, closing and after-pending balance, per material and warehouse."""
	frappe.has_permission("Stock Ledger Entry", "read", throw=True)
	date = getdate(date or nowdate())
	company = _branch_company(branch)
	warehouses = _warehouses(company, warehouse)
	raw_only = bool(flt(raw_only))
	raw_items = _raw_materials() if raw_only else None

	values = {"date": date, "warehouses": warehouses or [""]}
	item_cond = ""
	if raw_items is not None:
		values["items"] = list(raw_items) or [""]
		item_cond = "and sle.item_code in %(items)s"

	opening = {
		(r.item_code, r.warehouse): r
		for r in frappe.db.sql(
			f"""select sle.item_code, sle.warehouse, sum(sle.actual_qty) as qty,
				sum(sle.stock_value_difference) as value
			from `tabStock Ledger Entry` sle
			where sle.is_cancelled = 0 and sle.posting_date < %(date)s
				and sle.warehouse in %(warehouses)s {item_cond}
			group by sle.item_code, sle.warehouse""",
			values, as_dict=True,
		)
	}
	moves = frappe.db.sql(
		f"""select sle.item_code, sle.warehouse, sle.voucher_type, sle.voucher_no,
			sle.actual_qty, sle.stock_value_difference, se.purpose,
			log.name as consumption_log, waste.name as waste_log
		from `tabStock Ledger Entry` sle
		left join `tabStock Entry` se on sle.voucher_type = 'Stock Entry' and se.name = sle.voucher_no
		left join `tabURY Consumption Log` log on log.stock_entry = se.name
		left join `tabURY Waste Log` waste on waste.stock_entry = se.name
		where sle.is_cancelled = 0 and sle.posting_date = %(date)s
			and sle.warehouse in %(warehouses)s {item_cond}""",
		values, as_dict=True,
	)

	rows = {}

	def row(item_code, wh):
		key = (item_code, wh)
		if key not in rows:
			o = opening.get(key)
			rows[key] = {
				"item_code": item_code,
				"warehouse": wh,
				"opening": flt(o.qty) if o else 0.0,
				"opening_value": flt(o.value) if o else 0.0,
				**{c: 0.0 for c in CATEGORIES},
				"consumption_cost": 0.0,
				"pending_out": 0.0,
				"pending_in": 0.0,
			}
		return rows[key]

	for key, o in opening.items():
		if abs(flt(o.qty)) > 1e-9:
			row(*key)
	for m in moves:
		r = row(m.item_code, m.warehouse)
		kind = _category(m)
		r[kind] += flt(m.actual_qty)
		if kind == "sale_consumption":
			r["consumption_cost"] += -flt(m.stock_value_difference)

	# Drafts up to this day: not on the ledger yet, but already off the shelf.
	for p in _pending(date, warehouses, raw_items):
		r = row(p.item_code, p.warehouse)
		if flt(p.qty) < 0:
			r["pending_out"] += -flt(p.qty)
		else:
			r["pending_in"] += flt(p.qty)

	names = _item_details({k[0] for k in rows})
	out = []
	for r in rows.values():
		moved = sum(r[c] for c in CATEGORIES)
		r["closing"] = r["opening"] + moved
		r["after_pending"] = r["closing"] - r["pending_out"] + r["pending_in"]
		info = names.get(r["item_code"]) or {}
		r["item_name"] = info.get("item_name") or r["item_code"]
		r["item_group"] = info.get("item_group")
		r["stock_uom"] = info.get("stock_uom")
		r["valuation_rate"] = flt(info.get("valuation_rate"))
		# Sign as read on paper: out-goings as positive quantities.
		for c in ("transfer_out", "sale_consumption", "direct_sale", "waste"):
			r[c] = -r[c]
		r["short"] = r["after_pending"] < -1e-9
		out.append(r)
	out.sort(key=lambda r: (r["warehouse"] or "", r["item_name"] or ""))

	return {
		"date": date,
		"today": nowdate(),
		"company": company,
		"warehouses": _warehouse_options(company),
		"warehouse": warehouse,
		"raw_only": raw_only,
		"rows": out,
		"totals": {
			"consumption_cost": sum(r["consumption_cost"] for r in out),
			"materials": len({r["item_code"] for r in out}),
			"short": sum(1 for r in out if r["short"]),
			"pending": sum(1 for r in out if r["pending_out"] or r["pending_in"]),
		},
		"by_product": _consumption_by_product(date, branch, warehouses),
		"transfers": _transfers(date, warehouses),
	}


# --------------------------------------------------------------------------- pieces


def _category(m):
	if m.voucher_type in ("Purchase Invoice", "Purchase Receipt"):
		return "purchase"
	if m.voucher_type in ("POS Invoice", "Sales Invoice", "Delivery Note"):
		return "direct_sale"
	if m.voucher_type == "Stock Reconciliation":
		return "adjustment"
	if m.voucher_type == "Stock Entry":
		if m.consumption_log:
			return "sale_consumption"
		if m.waste_log:
			return "waste"
		if m.purpose == "Material Transfer":
			return "transfer_in" if flt(m.actual_qty) > 0 else "transfer_out"
		if m.purpose == "Material Receipt":
			return "purchase"
		if m.purpose == "Material Issue":
			return "waste"
	return "other"


def _pending(date, warehouses, raw_items):
	"""Net quantity of draft Stock Entries up to `date`, per item and warehouse (out negative)."""
	values = {"date": date, "warehouses": warehouses or [""]}
	item_cond = ""
	if raw_items is not None:
		values["items"] = list(raw_items) or [""]
		item_cond = "and d.item_code in %(items)s"
	return frappe.db.sql(
		f"""select item_code, warehouse, sum(qty) as qty from (
			select d.item_code, d.s_warehouse as warehouse, -d.transfer_qty as qty
			from `tabStock Entry Detail` d join `tabStock Entry` se on se.name = d.parent
			where se.docstatus = 0 and se.posting_date <= %(date)s and d.s_warehouse in %(warehouses)s {item_cond}
			union all
			select d.item_code, d.t_warehouse as warehouse, d.transfer_qty as qty
			from `tabStock Entry Detail` d join `tabStock Entry` se on se.name = d.parent
			where se.docstatus = 0 and se.posting_date <= %(date)s and d.t_warehouse in %(warehouses)s {item_cond}
		) x group by item_code, warehouse""",
		values, as_dict=True,
	)


def _consumption_by_product(date, branch, warehouses):
	"""What each product sold that day took from the shelves, posted or still in draft."""
	cond = ["log.posting_date = %(date)s", "log.status in ('Done', 'Draft')"]
	values = {"date": date}
	if branch and branch != "all":
		cond.append("log.branch = %(branch)s")
		values["branch"] = branch
	if warehouses:
		cond.append("item.warehouse in %(warehouses)s")
		values["warehouses"] = warehouses
	rows = frappe.db.sql(
		f"""select item.sold_item, item.item_code, max(item.stock_uom) as stock_uom,
			sum(item.qty) as qty, sum(item.amount) as cost,
			count(distinct log.name) as invoices, max(log.status = 'Draft') as has_draft
		from `tabURY Consumption Log Item` item
		join `tabURY Consumption Log` log on log.name = item.parent
		where {" and ".join(cond)}
		group by item.sold_item, item.item_code
		order by item.sold_item, cost desc""",
		values, as_dict=True,
	)
	sold = _sold_qty(date, branch, {r.sold_item for r in rows})
	names = _item_details({r.sold_item for r in rows} | {r.item_code for r in rows})
	products = {}
	for r in rows:
		p = products.setdefault(r.sold_item, {
			"item_code": r.sold_item,
			"item_name": (names.get(r.sold_item) or {}).get("item_name") or r.sold_item,
			"sold_qty": flt(sold.get(r.sold_item)),
			"cost": 0.0,
			"has_draft": False,
			"ingredients": [],
		})
		p["cost"] += flt(r.cost)
		p["has_draft"] = p["has_draft"] or bool(r.has_draft)
		p["ingredients"].append({
			"item_code": r.item_code,
			"item_name": (names.get(r.item_code) or {}).get("item_name") or r.item_code,
			"qty": flt(r.qty),
			"stock_uom": r.stock_uom,
			"cost": flt(r.cost),
		})
	return sorted(products.values(), key=lambda p: -p["cost"])


def _sold_qty(date, branch, items):
	if not items:
		return {}
	cond = ["inv.docstatus = 1", "inv.posting_date = %(date)s", "item.item_code in %(items)s", "ifnull(inv.is_return, 0) = 0"]
	values = {"date": date, "items": list(items)}
	if branch and branch != "all":
		cond.append("inv.branch = %(branch)s")
		values["branch"] = branch
	return dict(frappe.db.sql(
		f"""select item.item_code, sum(item.stock_qty)
		from `tabPOS Invoice Item` item join `tabPOS Invoice` inv on inv.name = item.parent
		where {" and ".join(cond)} group by item.item_code""",
		values,
	))


def _transfers(date, warehouses):
	"""The day's transfers between warehouses, posted and draft."""
	if not warehouses:
		return []
	entries = frappe.db.sql(
		"""select distinct se.name, se.docstatus, se.posting_time, se.owner, se.remarks
		from `tabStock Entry` se join `tabStock Entry Detail` d on d.parent = se.name
		where se.purpose = 'Material Transfer' and se.docstatus < 2 and se.posting_date = %(date)s
			and (d.s_warehouse in %(warehouses)s or d.t_warehouse in %(warehouses)s)
		order by se.posting_time""",
		{"date": date, "warehouses": warehouses}, as_dict=True,
	)
	if not entries:
		return []
	lines = {}
	for d in frappe.get_all(
		"Stock Entry Detail",
		filters={"parent": ["in", [e.name for e in entries]]},
		fields=["parent", "item_code", "item_name", "qty", "uom", "s_warehouse", "t_warehouse"],
		order_by="idx asc",
	):
		lines.setdefault(d.parent, []).append(d)
	users = dict(frappe.get_all("User", filters={"name": ["in", list({e.owner for e in entries})]},
								fields=["name", "full_name"], as_list=True))
	return [
		{
			"name": e.name,
			"status": "posted" if e.docstatus == 1 else "draft",
			"posting_time": str(e.posting_time or "")[:5],
			"owner_name": users.get(e.owner) or e.owner,
			"remarks": e.remarks,
			"items": [
				{"item_name": d.item_name or d.item_code, "qty": flt(d.qty), "uom": d.uom,
				 "from": d.s_warehouse, "to": d.t_warehouse}
				for d in lines.get(e.name, [])
			],
		}
		for e in entries
	]


# --------------------------------------------------------------------------- helpers


def _raw_materials():
	"""Items used as ingredients in an active recipe; None when there are no recipes at all."""
	items = set(frappe.db.sql_list(
		"""select distinct bi.item_code from `tabBOM Item` bi join `tabBOM` b on b.name = bi.parent
		where b.docstatus = 1 and b.is_active = 1"""
	))
	return items or None


def _branch_company(branch):
	if not branch or branch == "all":
		return None
	return frappe.db.get_value("POS Profile", {"branch": branch, "disabled": 0}, "company")


def _warehouses(company, warehouse=None):
	if warehouse:
		wh = frappe.db.get_value("Warehouse", warehouse, ["name", "is_group", "lft", "rgt"], as_dict=True)
		if not wh:
			frappe.throw(_("Warehouse {0} not found").format(warehouse))
		if not wh.is_group:
			return [wh.name]
		return frappe.get_all("Warehouse", filters={"lft": [">", wh.lft], "rgt": ["<", wh.rgt], "is_group": 0}, pluck="name")
	filters = {"is_group": 0}
	if company:
		filters["company"] = company
	return frappe.get_all("Warehouse", filters=filters, pluck="name")


def _warehouse_options(company):
	filters = {"is_group": 0, "disabled": 0}
	if company:
		filters["company"] = company
	return [
		{"name": w.name, "label": w.warehouse_name or w.name}
		for w in frappe.get_list("Warehouse", filters=filters, fields=["name", "warehouse_name"],
								 order_by="warehouse_name asc", limit_page_length=0)
	]


def _item_details(codes):
	if not codes:
		return {}
	return {
		i.name: i
		for i in frappe.get_all(
			"Item", filters={"name": ["in", list(codes)]},
			fields=["name", "item_name", "item_group", "stock_uom", "valuation_rate"],
		)
	}
