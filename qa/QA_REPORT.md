# SmartResto (`ury`) — Pre-Production QA Report

Phase 1 · branch `qa/pre-prod-2026-10-04` · 2026-10-04 · Frappe 15.98.1 / ERPNext 15.95.2 / Python 3.12.3

## Progress checklist

| # | Category | Status |
|---|---|---|
| 0 | Recon / system map | ✅ DONE — `qa/00_system_map.md` |
| 1 | Static analysis & code quality | ✅ DONE — executed on the code (read-only) |
| 2 | Installation, migration & upgrade | ⏳ PENDING ENV — tests written |
| 3 | Unit tests | ⏳ PENDING ENV — tests written |
| 4 | API / integration tests | ⏳ PENDING ENV — tests written |
| 5 | Permissions & role matrix | ⏳ PENDING ENV — tests written |
| 6 | Multi-tenancy isolation | ⏳ PENDING ENV — tests written |
| 7 | Realtime / KDS | ⏳ PENDING ENV — tests written |
| 8 | Concurrency & data integrity | ⏳ PENDING ENV — tests written |
| 9 | Accounting & stock integrity | ⏳ PENDING ENV — tests written |
| 10 | Frontend E2E | ⏳ PENDING ENV — tests written |
| 11 | Printing | ⏳ PENDING ENV — tests written |
| 12 | Security | ⏳ PENDING ENV — tests written (static part done in Cat. 1) |
| 13 | Performance & load | ⏳ PENDING ENV — tests written |
| 14 | Resilience & operations | ⏳ PENDING ENV — tests written |

**Why PENDING ENV:** the only available server hosts production (`portal.smartchoice-iq.com`, two demo
sites and a second bench). By the owner's decision of 2026-10-04 no site, restart, load or DB/Redis
write is allowed on it; a dedicated QA server is being provisioned. Categories 2–14 are written,
syntax-checked and lint-clean, and refuse to run on this host (verified, see §6).

---

## 1. Verdict

**NO-GO** — one Critical (SR-001, any logged-in user can create a System Manager) and seven High
findings from code review alone, and none of the runtime categories (2–14) have executed.

GO criteria: zero Critical ✗ · zero High ✗ · NEEDS DECISION resolved ✗ (11 open) · core E2E green ✗ (not run) · load thresholds met ✗ (not run).

---

## 2. Summary

"Run" counts checks that actually executed on this host. "Written" counts tests/checks ready for the QA server.

| # | Category | Run | Passed | Failed | Blocked | Written (not run) |
|---|---|---|---|---|---|---|
| 1 | Static analysis | 10 | 3 | 7 | 0 | — |
| 2 | Install / migrate / upgrade | 0 | 0 | 0 | 5 | 5 checks (`cat02_install_migrate.sh`) |
| 3 | Unit | 0 | 0 | 0 | 37 | 37 tests + the existing 62-file suite with `--coverage` |
| 4 | API / integration | 0 | 0 | 0 | 2 | 2 sweep tests (all 225 non-guest methods as Guest; 13 sensitive endpoints × roles) |
| 5 | Permissions & role matrix | 0 | 0 | 0 | 8 | 8 tests (branch isolation ×6, matrix + invariants ×2) |
| 6 | Multi-tenancy | 0 | 0 | 0 | 6 | 6 checks (`cat06_isolation.py`) |
| 7 | Realtime / KDS | 0 | 0 | 0 | 6 | 1 test + 5 checks (`cat07_realtime.py`) |
| 8 | Concurrency | 0 | 0 | 0 | 6 | 6 scenarios + `integrity_report` |
| 9 | Accounting & stock | 0 | 0 | 0 | 7 | 7 tests (shift close, expected cash, GL balance, merged-bill tender) |
| 10 | Frontend E2E | 0 | 0 | 0 | 26 | 13 checks × 2 viewports (`pos_critical_flow.cjs`) |
| 11 | Printing | 0 | 0 | 0 | 4 | 4 tests + PDFs for manual 58/80 mm review |
| 12 | Security | 0 | 0 | 0 | 25 | 15 tests + 10 HTTP probes |
| 13 | Performance & load | 0 | 0 | 0 | 1 | locust (40 POS + 8 KDS, 15 min) + slow-log/index script |
| 14 | Resilience | 0 | 0 | 0 | 5 | 5 checks (`cat14_resilience.sh`) |

New DB-backed tests: **74** methods in 9 files under `ury/tests/`. New scripts: 8.

---

## 3. Category 1 — Static analysis & code quality (executed)

Tools installed in an isolated venv `~/qa-tools/venv` (not the bench `env/`). Scope: `ury/` Python
(non-test unless stated) and the three TS front-ends with their own ESLint configs.

| # | Check | Command | Result | Verdict | Evidence |
|---|---|---|---|---|---|
| 1.1 | ruff lint (project config) | `ruff check ury` | 600 issues: 403 whitespace, 88 import order, 11 F811 redefinitions, 9 F841, 4 E722 bare `except`, 2 B006 mutable defaults | FAIL | `qa/evidence/static/ruff_check.txt` |
| 1.2 | ruff format | `ruff format --check ury` | 180 of 328 files would be reformatted | FAIL | `ruff_format.txt` |
| 1.3 | bandit | `bandit -r ury -x tests,node_modules,public` | 0 High, 46 Medium (45 × B608 dynamic SQL, 1 × B104), 42 Low (29 × B311 random, 13 × try/except/pass) | FAIL (B110 real, see SR-008) | `bandit.txt`, `bandit.json` |
| 1.4 | semgrep `p/python` | `semgrep --config p/python` | 151 rules × 266 files: **0 findings** | PASS | `semgrep_python.json` |
| 1.5 | semgrep Frappe rules (`frappe/semgrep-rules`) | `semgrep --config semgrep-rules/rules` | 772 (541 type-hint style, 56 untranslated strings, 45 SQL-format, 26 manual commit, 20 guest methods, 15 realtime-without-room, 9 side-effect-on-GET, 5 file-traversal, 2 set_user, 1 SSTI) | FAIL (triaged below) | `semgrep_frappe.json` |
| 1.6 | ESLint `pos/` | `eslint .` | 55 errors (42 `no-explicit-any`, 12 unused vars, 1 prefer-const), 181 warnings (172 design-system rule) | FAIL (Low) | `eslint_pos.json` |
| 1.7 | ESLint `frontend/` | `eslint .` | 0 errors, 370 warnings | PASS | `eslint_frontend.json` |
| 1.8 | ESLint `self-order/` | `eslint .` | 0 errors, 2 warnings | PASS | `eslint_self-order.json` |
| 1.9 | SQL-injection triage | `qa/tools/sql_taint_check.py` | 53 dynamic `frappe.db.sql` sites; 12 with parameter-chosen fragments; all 12 reviewed by hand: each fragment is a constant chosen by a condition or an allow-listed value (`employees.py:45`), values bound as params. **No SQL injection found.** | FAIL→reviewed, no defect | `sql_taint.txt` |
| 1.10 | Endpoint authz inventory | `qa/tools/endpoint_inventory.py` | 245 whitelisted, 20 guest, 45 with no authz signal — hand-reviewed → SR-001, SR-002, SR-006 | FAIL | `qa/evidence/endpoints.csv` |

Triage of the brief's flag list:

| Flag | Count | Outcome |
|---|---|---|
| SQL with f-string / format | 53 sites | no injection (1.9) |
| `eval` / `exec` | 0 | — |
| `allow_guest=True` | 20 | all token- or signature-gated except `get_site_name` (returns site name; Low) and the public reservation pair (rate-limited 8/h); see SR-011 |
| `ignore_permissions=True` | 105 (45 in demo/setup code) | the dangerous one is SR-001; self-ordering uses it behind a verified token by design |
| `frappe.db.commit()` in request handlers | 26 | SR-012 (inside cancel hook), SR-016 (GET-reachable); `www/*.py` and `self_ordering.py:304` are documented and justified |
| `frappe.flags.ignore_*` | 6 | `ignore_payment_sync` is part of SR-005; others benign |
| `frappe.set_user("Administrator")` | 1 helper | narrow, try/finally, after token check — accepted |
| N+1 in loops | several (`change_table_in_kot`, `price_items_for_invoice` 3 queries/line, `cancel_kot`) | performance only; measured in Cat. 13 |
| unhandled `None` from `get_value` | e.g. `getBranchRoom` (`ury_pos/api.py:208-216` indexes `[0]` with no empty check), `order_type_update` | Low; covered by Cat. 4 missing-data calls |

Semgrep Frappe items checked by hand and **rejected as false positives**: file-traversal ×5 (paths
are generated or `commonpath`-checked: `ury_print.py:67,246`, `qz_printing.py:149`), SSTI ×1
(`ury_daily_p_and_l.py:553` renders a fixed template path), B104 (`self_ordering_qr.py:113` is a
string comparison, not a bind).

---

## 4. Findings

Statuses are from code reading. Each finding names the test that will reproduce it on the QA server;
none has been reproduced at runtime yet.

```
ID: SR-001
Title: Any logged-in user can create a System Manager (setup API privilege escalation)
Severity: Critical
Category: 1 / 12 (Security — broken access control)
Location: ury/ury/api/minimal/business_setup.py:97-115 · ury.ury.api.minimal.business_setup.create_setup_user
Steps to reproduce: log in as any user (e.g. URY Captain); POST /api/method/ury.ury.api.minimal.business_setup.create_setup_user
  with email=x@y, name=x, password=<chosen>, role=System Manager; log in as x@y.
Expected vs Actual: Expected PermissionError for non-admins. Actual (code): no role check; a System User with the
  requested role is inserted with ignore_permissions=True and the password set via update_password.
  Frappe's User.validate (frappe/core/doctype/user/user.py) adds no role-assignment guard on this path.
  The method has no `methods=` restriction, so it is also reachable by GET — a link opened by any logged-in
  staff member's browser would run it (SameSite=Lax sends the session cookie on top-level GET).
Evidence: code read (lines above); endpoint inventory row authz_signal=none (qa/evidence/endpoints.csv).
Root cause (hypothesis): setup-wizard helper exposed as a general whitelisted method without a role gate.
Suggested fix: frappe.only_for("System Manager") (or URY Admin) + methods=["POST"]; validate `role` against an
  allow-list of URY roles; consider removing the endpoint after setup is complete.
Tests: ury/tests/test_qa_security_setup.py (3 tests), qa/scripts/cat12_security_probe.py 12.10
Status: Open
```

```
ID: SR-002
Title: Company / branch / restaurant setup writable by any logged-in user
Severity: High
Category: 1 / 5
Location: ury/ury/api/minimal/business_setup.py:42-95 (update_business_setup), :117-553 (submit_configure_data)
Steps to reproduce: as a cashier, call update_business_setup(branch='{"name": "<branch>", "tax_id": "X"}').
Expected vs Actual: Expected PermissionError. Actual: only Guest is refused; frappe.db.set_value("Company", …,
  "tax_id", …) and branch/restaurant/company creation run for any role.
Evidence: code read; inventory authz_signal=none.
Suggested fix: same gate as SR-001.
Tests: test_qa_security_setup.py::test_cashier_cannot_change_company_tax_id, ::test_cashier_cannot_run_configure
Status: Open
```

```
ID: SR-003
Title: Multi-cashier shift close adds another branch's sub-cashier cash
Severity: High
Category: 1 / 9 (cash reconciliation)
Location: ury/ury/hooks/ury_pos_closing_entry.py:37-58 (calculate_closing_amount)
Steps to reproduce: two POS Profiles with multiple cashiers; submit a Sub POS Closing on profile B; create the
  POS Closing Entry on profile A for an overlapping period.
Expected vs Actual: Expected A's closing = A's main cashier + A's sub cashier(s). Actual: Sub POS Closing is looked
  up with only posting_date <= / period_start_date >= / docstatus — no pos_profile, branch or opening-entry
  filter — and only the first row ([0]) is used; with several sub-cashiers, the rest are ignored.
Evidence: code read (filters at lines 42-46, `sub_pos_closing[0]` at line 51).
Suggested fix: filter by pos_profile (and pos_opening_entry / period) and sum all matching rows. Summing is a
  business rule → see ND-07.
Tests: ury/tests/test_qa_shift_reconciliation.py::TestQASubClosingScope (2 tests)
Status: Open
```

```
ID: SR-004
Title: "No changes after the bill is printed" guard misses removal of duplicate-item rows
Severity: High
Category: 1 / 3 (void after bill shown to guest)
Location: ury/ury/hooks/ury_pos_invoice.py:32-80 (validate_invoice)
Steps to reproduce: order the same item on two rows (e.g. tea + "tea, no sugar"); print the bill; edit the POS
  Invoice through Desk or /api/resource and delete one tea row; save.
Expected vs Actual: Expected ValidationError when remove_items=0. Actual: original/current items are dicts keyed
  by item_code, so the second row overwrites the first and the removal is invisible.
  (sync_order sums qty per item and is not affected — the gap is on direct document edits.)
Evidence: code read (dict comprehensions at lines 44-51; keyed by item_code).
Suggested fix: compare per-row (by row name) or aggregate qty per item_code.
Tests: ury/tests/test_qa_pos_invoice_hooks.py::TestQAPostPrintGuard (4 tests)
Status: Open
```

```
ID: SR-005
Title: Merged-bill payment sync records the partner's total once per tender row
Severity: High
Category: 1 / 9
Location: ury/ury/hooks/ury_pos_invoice.py:242-305 (sync_merged_invoice, runs on_update and on_submit)
Steps to reproduce: two bills linked by custom_merged_pos_invoice; save the primary with cash + card payments
  (any path except make_invoice, which sets flags.ignore_payment_sync).
Expected vs Actual: Expected partner payments = partner total. Actual: one row per primary tender row, each with
  amount = target.rounded_total → 2× with mixed tender. All exceptions are caught into Error Log, so a failed
  partner save leaves the primary paid and the partner an open draft without telling the cashier.
Evidence: code read (loop at lines 266-272, `except Exception` at 298-302).
Suggested fix: allocate the tender across invoices (as make_invoice does), or copy only on the make_invoice path;
  surface sync failures.
Tests: ury/tests/test_qa_merged_bill_payments.py (3 tests)
Status: Open
```

```
ID: SR-006
Title: Dashboard / service-line endpoints return any branch's sales to any logged-in user
Severity: High
Category: 1 / 5 (broken access control)
Location: ury/ury/api/ury_dashboard.py:6-317 (5 methods), ury/ury/api/ury_service_line.py:6-139 (2 methods)
Steps to reproduce: as a captain (or a user with no URY role) GET
  /api/method/ury.ury.api.ury_dashboard.get_dashboard_stats?branch=<other branch>.
Expected vs Actual: Expected PermissionError outside the user's role/branch. Actual: no role or branch check;
  raw SQL returns today's invoice count and revenue; results cached 30-300 s per branch.
Evidence: code read; inventory authz_signal=none; ury/ury/api/dashboard.py does check has_permission (contrast).
Suggested fix: require_manager()-style gate + branch check against getBranch() for non-managers.
Tests: test_qa_api_authz_matrix.py::TestQASensitiveEndpoints
Status: Open
```

```
ID: SR-014
Title: Production bench runs with CSRF disabled, wildcard credentialed CORS and developer_mode
Severity: High
Category: 12 (deployment configuration)
Location: ~/frappe-bench/sites/common_site_config.json (bench-wide); per-site developer_mode=1 on all 3 sites
Steps to reproduce: read the config (values only, no secrets were printed).
Expected vs Actual: Expected ignore_csrf unset, CORS limited to known origins, developer_mode 0 in production.
  Actual: ignore_csrf=1, allow_cors="*", cors={allow_credentials: true, origins: ["*"]}, developer_mode=1,
  plus allow_cors "http://142.93.168.28:5173" (a Vite dev server) on the portal site.
Evidence: python3 json read of the config files, 2026-10-04.
Root cause (hypothesis): development settings carried into production.
Suggested fix: remove ignore_csrf, restrict CORS, set developer_mode 0 — an ops change, see ND-01.
Tests: qa/scripts/cat12_security_probe.py 12.1, 12.3, 12.4 (run once with production parity, once corrected)
Status: NEEDS DECISION
```

```
ID: SR-007
Title: Order number derived from the last five characters of the invoice name
Severity: Medium
Category: 1 / 8
Location: ury/ury/api/ury_kot_order_number.py:4-102
Steps to reproduce: invoice series passing 99,999 (6-digit counter), or an amended invoice ("…-1").
Expected vs Actual: Expected sequential per-shift order numbers. Actual: int(name[-5:]) — past 99,999 the
  leading digit is dropped and numbering falls back to the raw counter; an amended name raises ValueError in
  after_insert, aborting the amend. Two bare `except: pass` blocks (lines 92, 99) hide lookup failures.
Evidence: code read; the brief's 100k-orders load profile reaches the 5-digit limit.
Suggested fix: store a per-shift counter on POS Opening Entry (row-locked) instead of parsing names.
Tests: test_qa_pos_invoice_hooks.py::TestQAOrderNumber (4), cat08_concurrency.py 8.3, integrity_report.duplicate_order_numbers
Status: Open
```

```
ID: SR-008
Title: Kitchen communication failures are swallowed silently
Severity: Medium
Category: 1 / 7
Location: ury/ury/doctype/ury_kot/ury_kot.py:28-33 (KOT print), ury/ury/doctype/ury_order/ury_order.py:2261-2266
  (KOT table change on transfer), :2431-2435 (cancel KOT on void)
Expected vs Actual: Expected a logged, visible failure. Actual: `except: pass` — a dead kitchen printer, a failed
  cancellation ticket (kitchen keeps cooking a voided order) or a failed table move leaves no trace.
  Also: POS-Profile KOT printers are only used when the production unit has its own printer (ND-09).
Evidence: code read; bandit B110 at those lines.
Suggested fix: frappe.log_error + URY KOT Error Log + realtime alert to the POS.
Tests: test_qa_kot_pipeline.py::TestQAKotPrinting (2)
Status: Open
```

```
ID: SR-009
Title: Settlement authorised against a client-supplied POS Profile, which is then written onto the invoice
Severity: Medium
Category: 1 / 5
Location: ury/ury/doctype/ury_order/ury_order.py:2539 (_require_settle_permission(pos_profile)), :2576
  (invoice.pos_profile = pos_profile)
Expected vs Actual: Expected the check against the invoice's own profile. Actual: the caller chooses the profile
  used for the billing-role check and the invoice is re-assigned to it (branch check still applies, so this is
  limited to profiles within the same branch). Affects which shift the sale is consolidated into.
Evidence: code read.
Suggested fix: use invoice.pos_profile for the check; reject a mismatch.
Tests: cat08 / Cat. 5 (add a profile-mismatch case once a second profile per branch exists)
Status: Open
```

```
ID: SR-010
Title: KOT and invoice realtime events broadcast to every Desk user on the site
Severity: Medium
Category: 1 / 6 / 7
Location: ury/ury/doctype/ury_kot/ury_kot.py:105-116 and 14 other publish_realtime calls (system map §2.5)
Expected vs Actual: Expected room/branch-scoped events. Actual: no room/user → Frappe's site room; the full KOT
  JSON (customer, table, items, notes) of every branch reaches every logged-in system user. Cross-site isolation
  relies on Frappe's per-site namespace (verified at runtime in Cat. 6).
Evidence: code read; frappe/realtime.py:58-71; semgrep frappe-realtime-pick-room ×15.
Suggested fix: publish to a doctype/branch room and subscribe KDS clients to it.
Tests: test_qa_kot_pipeline.py::TestQAKotRealtimeScope, cat07_realtime.py 7.1, cat06_isolation.py 6.1
Status: Open
```

```
ID: SR-011
Title: Guest self-ordering: internal error text returned to guests; QR signing secret readable by cashiers
Severity: Medium
Category: 1 / 12
Location: ury/ury/api/self_ordering.py:744-747 (frappe.throw(... .format(e))); URY Self Ordering Profile
  .qr_signing_secret (Data field, URY Cashier has read)
Expected vs Actual: Expected a generic message to anonymous users and the HMAC secret hidden from staff.
  Actual: the raw exception string is sent to the guest; any cashier can read the secret and mint a valid QR
  token for any table of that profile. QR tokens never expire (by design, printed cards).
Evidence: code read; doctype JSON (qa/evidence/doctypes.txt).
Suggested fix: log the exception, return a generic message; make the secret a Password field / permlevel 1.
Tests: test_qa_self_ordering_boundary.py (10 tests)
Status: Open
```

```
ID: SR-012
Title: frappe.db.commit() inside the POS Invoice cancel/trash hook path
Severity: Medium
Category: 1 / 9 / 14
Location: ury/ury/doctype/ury_order/ury_order.py:378-397 (release_merge_cluster_tables), called from
  ury_pos_invoice.on_trash (on_cancel and on_trash doc_events); also merge_tables_batch:149, unmerge_tables:777
Expected vs Actual: Expected the cancel to commit or roll back as one unit. Actual: the commit runs between
  on_cancel handlers, before consumption.on_pos_invoice_cancel — a later failure leaves a committed
  cancellation without its stock reversal.
Evidence: code read; semgrep frappe-manual-commit.
Suggested fix: drop the commit (Frappe commits at request end); keep realtime as after-commit.
Tests: cat14_resilience.sh 14.3 + integrity_report; add a failing-reversal case in Phase 2
Status: Open
```

```
ID: SR-016
Title: State-changing whitelisted methods accept GET
Severity: Medium
Category: 1 / 12 (CSRF)
Location: 9 sites flagged by semgrep whitelisted-side-effect-on-get (ury_kitchen_message.py:66,123,137;
  ury_order.py:149,777; ury_pos/api.py:1203,1830; qz_printing.py:281; business_setup.py:553) and every mutating
  method without methods=["POST"]
Expected vs Actual: Expected POST-only. Actual: reachable by GET, where CSRF tokens are not checked and
  SameSite=Lax cookies are sent on top-level navigation.
Evidence: semgrep_frappe.json.
Suggested fix: methods=["POST"] on every mutating endpoint.
Tests: cat12_security_probe.py 12.2 (enumerates them at runtime)
Status: Open
```

```
ID: SR-013
Title: Discount audit entry records old_value equal to new_value
Severity: Low
Category: 1 / 3
Location: ury/ury/doctype/ury_order/ury_order.py:2592 assigns the new percentage, :2601 then reads it as old_value
Tests: test_qa_money_flow.py::TestQADiscount::test_discount_is_audited
Status: Open
```

```
ID: SR-015
Title: Code-quality debt
Severity: Low
Category: 1
Location: duplicate method URYMenu.clear_item_price (ury_menu.py:37 and :43); 11 F811; 4 bare except;
  180 unformatted files; 55 ESLint errors in pos/; getBranchRoom indexes an empty result (ury_pos/api.py:208-216)
Status: Open
```

---

## 5. Categories 2–14 — tests written, pending environment

Each line: what is ready, and the exact block.

- **2 Installation/migration** — `qa/scripts/cat02_install_migrate.sh`: fresh install, migrate ×2 (Patch Log unchanged + no `Executing ury.patches`), upgrade from `QA_PREV_TAG` with data check, fixtures present (`qa_seed.fixtures_report`), uninstall leaves no orphaned Custom Fields and site responds. *Blocked: no QA site; production tag unknown (Q-03).*
- **3 Unit** — `test_qa_money_flow.py` (20: totals from menu rates, client price ignored, IQD whole dinars, large-order drift, negative/zero qty, client item_name, cash exact/over/under, mixed tender, negative tender, idempotent settle, captain refused, discount 10/0/negative/>100/non-numeric/100 %, audit), `test_qa_pos_invoice_hooks.py` (13), `test_qa_kot_pipeline.py` (4). Plus the existing suite: `bench run-tests --app ury --coverage`. *Blocked: no QA site.*
- **4 API** — `test_qa_api_authz_matrix.py`: every non-guest method dispatched as Guest through `frappe.handler.execute_cmd` must raise PermissionError before running; 13 sensitive endpoints × refused roles. *Blocked: no QA site.*
- **5 Permissions** — branch isolation (get_order_invoice, sync_order, make_invoice, cancel_order, `frappe.get_list`, `frappe.client.get`); role × 22 DocTypes × 6 ptypes written to `qa/evidence/role_matrix_observed.csv`, 9 hard invariants. *Blocked: no QA site.*
- **6 Multi-tenancy** — `qa/scripts/cat06_isolation.py`: concurrent flows on qa1/qa2 with realtime listeners both ways, cross-site cookie replay, private file, Redis key prefixes, RQ job site, data independence. *Blocked: needs both QA sites.*
- **7 Realtime/KDS** — `qa/scripts/cat07_realtime.py`: branch scope, latency p50/p95/max over 20 orders (budget ND-10), reconnect resync exactly-once, socketio restart in flight, nginx upgrade headers. Static: production nginx `/socket.io` blocks are correct (`config/nginx.conf:56-64,177-185`). *Blocked: no QA site.*
- **8 Concurrency** — `qa/scripts/cat08_concurrency.py`: same-table edits, 5× parallel payment, parallel numbering, request_id retry, shift close during payment, table-path double settle; then `qa_seed.integrity_report`. *Blocked: no QA site.*
- **9 Accounting & stock** — `test_qa_shift_reconciliation.py` (SR-003 ×2, expected cash vs independent sum, consolidated GL debit = credit and cash account = tender), `test_qa_merged_bill_payments.py` (3). Stock: recipe consumption reversal covered via integrity checks in Cat. 14. *Blocked: no QA site.*
- **10 E2E** — `qa/e2e/pos_critical_flow.cjs`: Arabic RTL, 1024×768 and 1280×800 touch; login → shift → table → items (long Arabic name) → send → KDS shows ticket → pay on throttled network with double tap → exactly one settlement → table free; console errors, failed API calls, overflow, empty search. *Blocked: no QA site; selectors are by Arabic label (no `data-testid` in `pos/src`), first run is a shakedown.*
- **11 Printing** — `test_qa_print_formats.py`: hostile + Arabic notes through the real order path, rendered with all 3 print formats; asserts no `<script`/`onerror`; writes HTML/PDF to `qa/evidence/print/` for the 58/80 mm visual check. Static: Frappe's Jinja env has no autoescape (`frappe/utils/jinja.py`), so safety rests on save-time sanitising — this is what the test verifies. *Blocked: no QA site.*
- **12 Security** — `test_qa_security_setup.py` (5), `test_qa_self_ordering_boundary.py` (10), `qa/scripts/cat12_security_probe.py` (10: CSRF, GET mutation, CORS, error leakage, IDOR, guest rate limits, config files, clickjacking, SR-001 over HTTP). *Blocked: no QA site.*
- **13 Load** — `qa_seed.seed_load` (3 branches, 500 items, 40 users × 2 tables, 100k historical invoices bulk-inserted without GL), `qa/load/locustfile.py` (40 POS + 8 KDS pollers, thresholds enforced: p95 < 500 ms order/payment, 0 errors), `qa/load/db_observe.sh` (slow log ≥ 0.2 s, digest, index candidates). *Blocked: no QA server; production host load forbidden.*
- **14 Resilience** — `qa/scripts/cat14_resilience.sh`: Redis, MariaDB and worker kill under Cat. 8 traffic with integrity report after each; backup → restore to `qa-restore.localhost` with count + revenue comparison; bench doctor, Error Log, scheduler. *Blocked: restarts forbidden on production.*

---

## 6. Metrics

| Metric | Value | Source |
|---|---|---|
| Coverage | not measured — Cat. 3 not run | — |
| Load p50/p95/p99, error rate | not measured — Cat. 13 not run | — |
| Slow queries / missing indexes | not measured | — |
| Whitelisted endpoints / guest / no authz signal | 245 / 20 / 45 | `endpoints.csv` |
| Dynamic SQL sites / injection found | 53 / 0 | `sql_taint.txt` |
| semgrep p/python findings | 0 | `semgrep_python.json` |
| bandit High / Medium | 0 / 46 (45 reviewed false positive B608, 1 false positive B104) | `bandit.json` |
| Existing test files | 62 (≈ 10.5k lines, mostly mocked) | `find ury -name 'test_*.py'` |
| New QA tests | 74 DB-backed + 8 scripts | `ury/tests/`, `qa/` |
| Production guard self-test | 8/8 scripts refused on this host (exit 1/2) before any network/DB call | run 2026-10-04 21:0x UTC |

---

## 7. NEEDS DECISION

| ID | Question | Where it matters |
|---|---|---|
| ND-01 | Production config: is `ignore_csrf=1`, `allow_cors="*"` with credentials, `developer_mode=1` intended? (SR-014) | Cat. 12 |
| ND-02 | Who may give a 100 % discount, and is there a per-role ceiling? (code allows 100 % to URY Cashier) | `test_full_discount` |
| ND-03 | A non-numeric discount value settles at full price today (`flt("abc") = 0`). Reject or accept? | `test_non_numeric_discount_is_not_silently_zero` |
| ND-04 | Should URY Cashier have **write** on URY Menu (changes prices) and URY Restaurant (tax template, active menu)? | role matrix |
| ND-05 | May a captain split a bill? (split_bill has no settle-permission gate) | `test_captain_cannot_split` |
| ND-06 | Guest self-ordering: maximum quantity per line / per order? (none today) | `test_negative_and_huge_qty_rejected` |
| ND-07 | Multi-cashier close: sum all sub-cashier closings of the profile, or exactly one sub-cashier per profile? | SR-003 |
| ND-08 | Underpayment / partial payment on a POS bill: always reject? | `test_underpayment_is_rejected…` |
| ND-09 | Should the POS Profile KOT printer be the fallback when a production unit has no printer? | SR-008 |
| ND-10 | Acceptable KDS latency (order sent → ticket on screen)? Proposed p95 ≤ 2 s. | Cat. 7 |
| ND-11 | KDS hides unprepared tickets older than 3 h (`kot_list`). Intended? | Cat. 7 |

## 8. Open questions for the owner

- **Q-01** QA server details: host, SSH user, MariaDB root password delivery, whether `sudo supervisorctl/systemctl` is allowed (needed for 7.4 and 14).
- **Q-02** Which POS front-ends are in production scope: `/pos` (React) only, or also `/urypos` (Vue) and the Desk `point-of-sale` page?
- **Q-03** Which tag/commit runs in production today (baseline for the upgrade test)? Latest tag in the repo is `v3.0.0-beta.1`.
- **Q-04** Is multi-cashier enabled on any of the 3 production branches? (weights SR-003)

## 9. Environment notes

- The brief said Python 3.11; the bench runs **3.12.3**. QA server should match production.
- During this session, untracked files appeared in the working tree that this engagement did not create:
  `.agents/`, `.archify/`, `ury/ury/api/architecture_viewer.py`, `ury/ury/api/architecture_viewer_server.py`
  (created 2026-10-04 20:44–20:58 UTC; adds 3 non-guest whitelisted methods incl. `start`/`stop`). They are
  excluded from the inventory (git-tracked files only) and were **not** committed.
