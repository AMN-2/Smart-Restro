# SmartResto (`ury`) — System Map & Risk Ranking

Phase 0 deliverable · branch `qa/pre-prod-2026-10-04` · 2026-10-04
Method: read-only code reading and static parsing. Nothing in this file comes
from a running site. Every number below has a command or file reference.

---

## 1. Environment facts (verified, read-only)

| Item | Brief said | Actual | Evidence |
|---|---|---|---|
| App path | `apps/smartresto` | `apps/ury` (remote `AMN-2/Smart-Restro`, module `URY`, title "Smart Restro"). User confirmed `ury` = SmartResto. | `git remote -v`, `ury/hooks.py:6-7` |
| Frappe | v15 | **15.98.1** | `apps/frappe/frappe/__init__.py` |
| ERPNext | — | **15.95.2** (required app) | `apps/erpnext/erpnext/__init__.py`, `hooks.py: required_apps` |
| Python | 3.11 | **3.12.3** (bench `env/`) | `env/bin/python --version` |
| Test sites | `qa1.localhost`, `qa2.localhost` | **Do not exist.** Bench hosts `portal.smartchoice-iq.com` (default site, live), `demo.smarterp.com`, `demo.smart_chat.com`. A second bench (`~/v15-setup/frappe-bench-v15`) also runs on the same host. | `ls sites/`, `ps` |
| Status | — | This server is **production**. Per user instruction: no sites, restarts, load, or DB/Redis writes here. Categories 2–14 wait for a dedicated QA server. | user decision 2026-10-04 |

---

## 2. App inventory

### 2.1 Size
- Python (non-test) ≈ 18k lines; 62 existing test files (≈ 10.5k lines, mostly mocked; no DB-backed `sync_order → make_invoice` flow exists).
- Front-ends (separate Vite builds, served from `ury/public/*`):

| Route | Source dir | Stack | Purpose |
|---|---|---|---|
| `/pos/*` | `pos/` | React + TS | **Current POS** (cashier + captain order pad) |
| `/urypos/*` | `urypos/` | Vue | Legacy POS |
| `/ury/*`, `/setup-wizard` | `frontend/` | React + TS | Management dashboard, reports, setup |
| `/mosaic/*` | `mosaic/` | Vue (built bundle) | **KDS** (kitchen display) |
| `/order/*` | `self-order/` | React + TS | Guest QR / kiosk self-ordering |
| `/driver`, `/feedback`, `/restaurant` | `ury/www/*.py` | Jinja + vanilla JS | Signed-link driver app, guest feedback, public site |
| Desk `point-of-sale` | `ury/public/js/pos_extend.js` | Frappe page JS | ERPNext POS extension |

### 2.2 DocTypes (70 total: 41 standalone, 29 child tables)

**Submittable (5):** `URY KOT`, `Sub POS Closing`, `URY Daily P and L`, `URY Waste Log`, and ERPNext's `POS Invoice` (extended).
**Singles:** `URY Order` (controller module only, holds the order API), `URY Feature Settings`.

Core transactional DocTypes and their links:

| DocType | Naming | Key links | Roles with write |
|---|---|---|---|
| POS Invoice (ERPNext, ~110 custom fields) | `naming_series` from `URY Restaurant.invoice_series_prefix` | restaurant, branch, restaurant_table, waiter, cashier, custom_merged_pos_invoice | (ERPNext perms + patches) |
| URY KOT | naming_series (`POS Profile.custom_kot_naming_series`) | invoice, restaurant_table, production, branch, pos_profile | Captain/Cashier `rwcsc`, Manager, Admin |
| URY Table | prompt | restaurant, restaurant_room, branch | Cashier rw, Manager/Admin rwcd |
| URY Menu / URY Menu Item | prompt | price_list (auto-created, `restaurant_menu`), branch | Cashier rw (!), Manager/Admin |
| Sub POS Closing (+ Payment, Invoices) | `SUB-CLO-.YYYY.-.#####` | pos_opening_entry, pos_profile, user | Cashier rwcs, Manager/Admin |
| URY Ordering Session / Device | hash / prompt | ordering_profile, table, invoice | System/Admin/Manager |
| URY Delivery / Driver / Zone | naming_series / field | invoice, driver, branch | Cashier/Captain rwc |
| URY Consumption Log | `CONS-{YYYY}-{#####}` | pos_invoice, stock_entry | Manager/Admin |
| URY Audit Log | hash | reference_doctype/name | read-only for Manager/Admin/System |

Full per-DocType field/link/permission dump: `qa/evidence/doctypes.txt`.

### 2.3 Hooks (`ury/hooks.py`)

| Hook | Target | Notes |
|---|---|---|
| `doc_events["POS Invoice"]` | `before_insert`, `validate`, `after_insert` (order number + floor event), `before_submit`, `on_submit` (merged sync, **stock consumption**, floor event), `on_update`, `on_update_after_submit`, `on_cancel` (consumption reversal), `on_trash` | Core money path. `ury/ury/hooks/ury_pos_invoice.py` |
| `doc_events["POS Opening Entry"]` | room assignment, multi-cashier "main must be open", last-invoice snapshot for order numbers | `ury_pos_opening_entry.py`, `ury_kot_order_number.py` |
| `doc_events["POS Closing Entry"]` | multi-cashier closing amount = Sub POS Closing + main | `ury_pos_closing_entry.py` |
| `doc_events["Sales Invoice"]`, `Item`, `POS Profile`, `URY Table`, `URY Menu Course` | misc validation / realtime | |
| `scheduler_events` | **cron `* * * * *`** `kotValidationThread` (creates missing KOTs), **hourly** `consumption.retry_failed`, **daily** sync-request purge + driver-position purge | |
| `before_request` / `after_request` / `on_session_creation` / `website_path_resolver` | feature flags, Desk lockout, login landing | `controllers/access.py` |
| `override_whitelisted_methods` | `erpnext.setup.demo.clear_demo_data` → `ury.setup.demo.clear_demo_data` | |
| `fixtures` | ~120 Custom Fields, 1 Property Setter, `URY %` roles, `Self Ordering Manager`, **all Client Scripts** (unfiltered) | |
| `after_install` / `before_uninstall` | `ury.install.after_install` / `ury.uninstall.uninstall` | |

**Patches** (`patches.txt`, all `post_model_sync`, `v2_0`): default_permissions, fix_waiter_order_slip_print_format, admin_permissions, rename_ury_workspace_to_smart_restro (contains `frappe.db.commit()`), add_table_close_fields (commit), publish_menu_prices, rename_driver_position_field, course_to_item_group, iraqi_dinar_display.

### 2.4 Whitelisted API surface

Generated by `qa/tools/endpoint_inventory.py` → `qa/evidence/endpoints.csv` (repeatable, static).

- **245** whitelisted methods; **20** `allow_guest=True`; **45** with no authorization signal in the body (heuristic, each checked by hand below).
- Largest modules: `ury_pos/api.py` (29), `ury_order.py` (20), `self_ordering.py` (14), `ury_kot_display.py` (13), `purchases.py` (12).

**Guest endpoints (20):**

| Module | Methods | Auth mechanism | Rate-limited |
|---|---|---|---|
| `api/self_ordering.py` | get_ordering_context, assign_device_table, get_customer_menu, get_customer_product, get_customer_order, add_customer_items, request_bill, call_waiter, get_order_status, create_payment_request, get_payment_status, share_payment_link | HMAC QR token (per-profile secret, no expiry) → hashed session token; internal work under `frappe.set_user("Administrator")` | yes (per-IP, hourly) |
| `api/driver_app.py` | driver_state, report_position, driver_set_status | signed link (`signed_links.py`, site encryption key, no expiry; revoked by `URY Driver.active=0`) | yes |
| `api/feedback.py` | page_context, submit_feedback | signed link | yes |
| `api/restaurant_website.py` | availability, reserve | none (public booking) | check in Cat. 12 |
| `api/ury_kot_display.py` | get_site_name | none, returns `frappe.local.site` | no |

**Endpoints with no authz check (hand-reviewed, the ones that matter):**

| Endpoint | What it does | Risk |
|---|---|---|
| `api.minimal.business_setup.create_setup_user(email,name,password,role)` | Inserts a **System User with any role** and sets its password, `ignore_permissions=True` | **Privilege escalation** → SR-001 |
| `api.minimal.business_setup.update_business_setup`, `submit_configure_data` | Writes Company tax_id, Branch, URY Restaurant, menus; only blocks Guest | Any staff can rewrite company setup → SR-002 |
| `api.minimal.setup_organization.submit_setup` / `complete_wizard_setup` | Guarded by `setup_complete` flag only | Low after setup; check in Cat. 5 |
| `api.ury_dashboard.*` (5), `api.ury_service_line.*` (2) | Raw-SQL sales totals / table state for **any branch** passed in | Revenue disclosure to any logged-in user → SR-006 |
| `api.ury_kitchen_message.*` (5) | send/ack/dismiss kitchen messages for a client-given branch | Cross-branch write; Cat. 5 |
| `api.ury_print.network_printing(doctype,name,...)` | Renders any doctype/name to a CUPS printer | IDOR on print (depends on `frappe.get_print` perms) → Cat. 12 test |
| `ury_order.merge_free_tables`, `merge_tables_batch`, `unmerge_tables` | Table state mutation | Cat. 5 |
| `api.promotions.check_coupon`, `api.loyalty.get_customer_loyalty`, `api.delivery.quote_delivery` | Reads | Low |

### 2.5 Realtime (Socket.IO) events

All published with `frappe.publish_realtime`. In Frappe 15 an event with no `room`/`user`/`doctype` goes to the **site room = every logged-in Desk user on that site** (`frappe/realtime.py:58-71`). Site isolation then rests on Frappe's per-site socket namespace; branch isolation rests on the client only subscribing to its own channel name.

| Event / channel | Published from | Scope | Payload |
|---|---|---|---|
| `kot_update_{branch}_{production}` | `URY KOT.kotDisplayRealtime` (`ury_kot.py:112`), `change_table_in_kot` | **site-wide** | full KOT JSON (customer, table, items, comments) + alert sound |
| `kot_item_update_{branch}_{production}` | `ury_kot_display.set_kot_item_prepared` | site-wide | kot, row, user |
| `kot_error_{branch}_{production}` | `ury_kot_validation.create_kot_log` | site-wide | kot, invoice, branch |
| `menu_availability_{branch}` | `ury_kot_display` | site-wide | item, available, user |
| `pos_invoice_updated`, `reload_ro` | `ury_pos_invoice.py:166,288` | site-wide | invoice name, paid_amount |
| `ury_print_jobs_{branch}` | `qz_printing.py:327` | site-wide | branch |
| print channel | `ury_print.py:194` | site-wide | print data |
| floor event | `floor_events._flush` | **doctype room** (`get_doctype_room`) | branch, invoices, tables |
| service requests, waitlist, kitchen message | respective modules | site-wide per-branch channel | |
| `ury_configure_progress` | `business_setup.py` | `user=` scoped | progress |

nginx (`config/nginx.conf:56-64,177-185`) proxies `/socket.io` with `proxy_http_version 1.1` + `Upgrade`/`Connection: upgrade` — **correct**.

### 2.6 ERPNext integration points
- **POS Invoice** is the order (draft = open bill, submit = paid). Consolidated into Sales Invoice by ERPNext POS Closing Entry → GL / stock posted there.
- **Stock**: `consumption.on_pos_invoice_submit` records a `URY Consumption Log` under a savepoint and enqueues `process_log` with `enqueue_after_commit=True`; the Stock Entry is made in that background job (its `frappe.db.commit()` calls at `consumption.py:168,183` are in the job, not the request). Reversed on cancel; failures retried hourly.
- **Loyalty**: `apply_loyalty_to_invoice` before save in `make_invoice`; errors swallowed except `ValidationError`.
- **Payments**: POS Invoice `payments` child table; mixed tender supported; merged bills split tender across two invoices (`ury_order.py:2613-2646`) and sync via `sync_merged_invoice` hook.
- **Shift**: POS Opening Entry / POS Closing Entry (ERPNext) + URY `Sub POS Closing` for multi-cashier.

---

## 3. Critical business flows → code

| # | Flow step | Entry point(s) | Guards observed |
|---|---|---|---|
| F1 | Open shift | `ury_pos/api.py:posOpening`, `POS Opening Entry` hooks | multi-cashier: main must be open first |
| F2 | Take order (dine-in / takeaway / delivery / aggregator) | `ury_order.sync_order` (`ury_order.py:1699`), `self_ordering.add_customer_items` (guest) | `request_id` idempotency (`URY Sync Request`), branch check, price re-derived server-side (`price_items_for_invoice`) |
| F3 | Send to kitchen | `ury_kot_generate.kot_execute` → `URY KOT` submit → realtime `kot_update_*`; network print via `multi_print_kot` | print errors swallowed (SR-008); per-minute cron recreates missing KOTs |
| F4 | KDS status updates | `ury_kot_display.*` (13 methods) | `_assert_kot_access`, branch check |
| F5 | Modify / void items | `sync_order` (diff), `ury_pos_invoice.validate_invoice` (post-print lock), `cancel_order` | post-print lock keyed by `item_code` (SR-004) |
| F6 | Split / merge bill | `split_bill` (`:833`), `merge_tables_batch` (`:30`), `sync_merged_invoice` hook | merged payment sync (SR-005) |
| F7 | Discount | `_validate_additional_discount` + inline checks in `make_invoice` | server-side role + profile flag, ≤100% |
| F8 | Payment (cash/card/mixed) | `ury_order.make_invoice` (`:2520`) | row lock + idempotent replay on invoice path; settle permission uses client-supplied `pos_profile` (SR-009) |
| F9 | Print receipt | `ury_print.*`, `qz_printing.*`, print formats (3) | |
| F10 | Close table | `close_table` (`:484`), `release_tables_after_print`, `_free_tables_if_no_open_invoices` | `_may_settle` |
| F11 | Close shift + cash reconciliation | ERPNext POS Closing Entry + `ury_pos_closing_entry.calculate_closing_amount`, `Sub POS Closing` | Sub closing lookup unscoped (SR-003) |
| F12 | Menu mgmt / availability / modifiers | `URY Menu` (price list regen deletes all Item Prices of that list), `menu_quick_add`, `ury_kot_display` availability toggle, `Item Add On` | |
| F13 | Guest self-ordering & payment link | `self_ordering.*` (12 guest methods), `payment_terminal` | token + rate limit + Admin elevation |
| F14 | Delivery / driver | `delivery.*`, `driver_app.*` | signed links |

---

## 4. Risk ranking

Scoring: **Impact** (money/data loss = 5 … cosmetic = 1) × **Likelihood** (from code evidence: confirmed defect = 5, unverified concurrency/edge = 3, defensive gap = 2). Static evidence only; every item has a runtime test written and pending the QA server.

| Rank | Area / flow | Impact | Likelihood | Score | Why | Finding / test |
|---|---|---|---|---|---|---|
| **1** | Setup API privilege escalation | 5 | 5 | **25** | Any logged-in user → new System Manager with chosen password | SR-001 · `test_qa_security_setup.py` |
| **2** | Shift close / cash reconciliation (multi-cashier) F11 | 5 | 5 | **25** | Sub POS Closing fetched without profile/branch filter, only `[0]` used | SR-003 · `test_qa_shift_reconciliation.py` |
| **3** | Post-print item removal guard F5 | 5 | 3 | **15** | Dict keyed by `item_code` hides removal of duplicate-item rows when a printed bill is edited via Desk/REST (`sync_order` itself sums by item and is not affected) → void after bill shown to guest | SR-004 · `test_qa_pos_invoice_hooks.py` |
| **4** | Merged-bill payment sync F6/F8 | 5 | 4 | **20** | Each tender row copied at full target total → overstated paid amount with mixed tender; failures swallowed | SR-005 · `test_qa_merged_bill_payments.py` |
| **5** | Company/branch setup writable by any staff | 4 | 5 | **20** | Only Guest is blocked | SR-002 · `test_qa_security_setup.py` |
| **6** | Payment + order concurrency F2/F8 | 5 | 3 | **15** | Invoice path is locked; table path relies on timestamp check; order no. from name suffix; shift close during payment | SR-007 · `qa/scripts/cat08_concurrency.py` |
| **7** | Dashboard / service-line data exposure | 4 | 4 | **16** | No role or branch check on 7 raw-SQL endpoints | SR-006 · `test_qa_api_authz_matrix.py` |
| **8** | Kitchen ticket delivery F3 | 4 | 3 | **12** | Network print errors swallowed (`except: pass`); relies on cron to recreate KOTs | SR-008 · `test_qa_kot_pipeline.py` |
| **9** | Realtime scope / tenant + branch isolation | 4 | 3 | **12** | All KOT payloads broadcast site-wide; isolation relies on socket namespaces + client filtering | SR-010 · `qa/scripts/cat06_isolation.py`, `cat07_realtime.py` |
| **10** | Guest self-ordering boundary F13 | 4 | 2 | **8** | 12 guest methods, Admin elevation, raw exception text returned to guest, static QR tokens | SR-011 · `test_qa_self_ordering_boundary.py` |
| 11 | Settle permission vs client `pos_profile` F8 | 3 | 3 | 9 | Permission computed on client-supplied profile, then written to invoice | SR-009 |
| 12 | Order number derivation | 3 | 3 | 9 | `int(name[-5:])`; breaks past 99,999 or with amended names | SR-007 |
| 13 | Commit inside cancel hook | 4 | 2 | 8 | `release_merge_cluster_tables` (`ury_order.py:378-397`) commits, and runs from the POS Invoice `on_cancel`/`on_trash` hooks → a cancel is committed before the consumption reversal handler runs | SR-012 · Cat. 9 / 14 |
| 14 | Menu price list regeneration | 3 | 2 | 6 | `delete from tabItem Price where price_list=%s` on every menu save | Cat. 3 |
| 15 | Install/migrate/uninstall | 3 | 2 | 6 | Unfiltered `Client Script` fixture, commits in patches | Cat. 2 |

---

## 5. Open questions affecting later categories
1. Which POS front-end is in production scope — `/pos` (React) only, or also `/urypos` (Vue legacy) and the Desk `point-of-sale` page?
2. Is multi-cashier (`custom_enable_multiple_cashier`) used by any of the 3 production branches? (Weights SR-003.)
3. Previous released tag for the upgrade test (Cat. 2): no tags in this fork's `develop` were checked yet — confirm which tag/commit is currently in production.
