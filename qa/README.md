# SmartResto QA suite — run book (QA server only)

Branch `qa/pre-prod-2026-10-04`. Everything here was written on the production host, where running
it is forbidden, so **nothing below has been executed yet**. Every script and test class refuses to
run on a bench that contains a production site directory, or against a non-`qa*.localhost` host.

## 0. QA server setup

```bash
# bench with the same versions as production: frappe 15.98.1, erpnext 15.95.2, python 3.12
cd ~/frappe-bench && bench get-app https://github.com/AMN-2/Smart-Restro.git --branch qa/pre-prod-2026-10-04
python3.12 -m venv ~/qa-tools/venv && ~/qa-tools/venv/bin/pip install -r apps/ury/qa/requirements-qa.txt

# Production parity: production runs with these bench-wide values (SR-014). Test with them,
# then again with them corrected, so Cat. 12 measures what production actually exposes.
bench set-config -g ignore_csrf 1
bench set-config -g developer_mode 1
bench set-config -g allow_cors '*'
```

## 1. Category → command

| Cat | What | Command (from `~/frappe-bench`) | Evidence |
|---|---|---|---|
| 1 | Static analysis | already run on the code — see `qa/QA_REPORT.md` | `qa/evidence/static/` |
| 2 | Install / migrate / upgrade / uninstall | `QA_DB_ROOT_PASSWORD=… QA_ADMIN_PASSWORD=… QA_PREV_TAG=<prod tag> bash apps/ury/qa/scripts/cat02_install_migrate.sh` | `qa/evidence/cat02/` |
| — | Seed worlds (needed by 3–14) | `bench --site qa1.localhost execute ury.tests.qa_seed.seed_worlds --kwargs "{'suffixes':'A,B'}" > apps/ury/qa/evidence/world_qa1.localhost.json`<br>`bench --site qa2.localhost execute ury.tests.qa_seed.seed_worlds --kwargs "{'suffixes':'Z'}" > apps/ury/qa/evidence/world_qa2.localhost.json` | |
| 3, 4, 5, 9, 11, 12 | DB-backed unit/API/permission/money/print/security tests | `bench --site qa1.localhost set-config allow_tests true`<br>`bench --site qa1.localhost run-tests --app ury --coverage 2>&1 \| tee apps/ury/qa/evidence/run_tests.log` | `run_tests.log`, `coverage.xml`, `qa/evidence/role_matrix_observed.csv`, `qa/evidence/print/` |
| 6 | Tenant isolation (both sites) | `~/qa-tools/venv/bin/python apps/ury/qa/scripts/cat06_isolation.py` (set `QA_DB_1`, `QA_DB_2` to the sites' `db_name`) | `cat06_isolation.json` |
| 7 | Realtime / KDS | `~/qa-tools/venv/bin/python apps/ury/qa/scripts/cat07_realtime.py` (add `QA_ALLOW_RESTART=1` for 7.4) | `cat07_realtime.json` |
| 8 | Concurrency | `~/qa-tools/venv/bin/python apps/ury/qa/scripts/cat08_concurrency.py` then `bench --site qa1.localhost execute ury.tests.qa_seed.integrity_report --kwargs "{'since':'<start>'}"` | `cat08_concurrency.json` |
| 10 | Browser E2E (Arabic RTL, 1024×768 + tablet) | `QA_URL=http://qa1.localhost:8000 node apps/ury/qa/e2e/pos_critical_flow.cjs` | `qa/evidence/cat10/` (screenshots, results.json) |
| 12 | HTTP security probe | `~/qa-tools/venv/bin/python apps/ury/qa/scripts/cat12_security_probe.py` | `cat12_security_probe.json` |
| 13 | Load: 3 branches, 500 items, 100k history, 40 POS users, 15 min | `bench --site qa1.localhost execute ury.tests.qa_seed.seed_load > apps/ury/qa/evidence/load_manifest.json`<br>`QA_DB_ROOT_PASSWORD=… QA_DB_NAME=… bash apps/ury/qa/load/db_observe.sh start`<br>`~/qa-tools/venv/bin/locust -f apps/ury/qa/load/locustfile.py --headless -u 48 -r 4 -t 15m --csv apps/ury/qa/evidence/cat13/locust --html apps/ury/qa/evidence/cat13/report.html --host http://qa1.localhost:8000`<br>`bash apps/ury/qa/load/db_observe.sh stop` | `qa/evidence/cat13/` |
| 14 | Resilience, backup/restore, hygiene | `QA_DB_ROOT_PASSWORD=… QA_ADMIN_PASSWORD=… bash apps/ury/qa/scripts/cat14_resilience.sh` | `qa/evidence/cat14/` |

Run order: 2 → seed → 3/4/5/9/11/12 (run-tests) → 6 → 7 → 8 → 10 → 12 (probe) → 13 → 14.

## 2. Reading results

- A failing test named after an `SR-###` is that finding reproducing; that is the expected
  outcome until Phase 2 fixes it.
- A failure in `setUpClass` / `RestaurantWorld.build` is a **fixture** problem until proven
  otherwise: the fixtures have never run. Fix the fixture, never the assertion (Hard Rule 3).
- Tests marked `# NEEDS DECISION` assert one proposed answer to an open business question;
  their result is only meaningful once the owner decides.

## 3. Files

```
qa/00_system_map.md            Phase 0 map + risk ranking
qa/QA_REPORT.md                Phase 1 report (checklist at top)
qa/tools/endpoint_inventory.py static whitelist inventory -> qa/evidence/endpoints.csv
qa/scripts/qa_env.py           guard + HTTP/Socket.IO client shared by the scripts
qa/scripts/cat0{2,6,7,8}*, cat12*, cat14*   category scripts
qa/load/locustfile.py, db_observe.sh        Cat. 13
qa/e2e/pos_critical_flow.cjs   Cat. 10
ury/tests/qa_base.py           site guard + RestaurantWorld fixtures
ury/tests/qa_seed.py           seeding + integrity_report + fixtures_report + counts_snapshot
ury/tests/test_qa_*.py         DB-backed tests (run by bench run-tests)
```
