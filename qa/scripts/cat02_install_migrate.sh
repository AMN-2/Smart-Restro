#!/usr/bin/env bash
# QA Cat. 2 — installation, migration, upgrade, fixtures, uninstall. QA SERVER ONLY.
#
#   2.1 fresh install of erpnext + ury on QA_SITE_1 with zero errors
#   2.2 migrate twice; the second run executes no patch
#   2.3 upgrade: PREV_TAG installed, sample data, current branch, migrate, data intact
#   2.4 fixtures present after install
#   2.5 uninstall leaves no orphaned fixture records and the site still works
#
# Env: QA_BENCH (default ~/frappe-bench), QA_SITE_1 (qa1.localhost), QA_UPGRADE_SITE (qa-upgrade.localhost),
#      QA_UNINSTALL_SITE (qa-uninstall.localhost), QA_PREV_TAG (v3.0.0-beta.1 — confirm with the owner),
#      QA_DB_ROOT_PASSWORD, QA_ADMIN_PASSWORD, QA_RECREATE=1 to drop+recreate an existing QA site.
set -uo pipefail

BENCH="${QA_BENCH:-$HOME/frappe-bench}"
SITE="${QA_SITE_1:-qa1.localhost}"
UPGRADE_SITE="${QA_UPGRADE_SITE:-qa-upgrade.localhost}"
UNINSTALL_SITE="${QA_UNINSTALL_SITE:-qa-uninstall.localhost}"
PREV_TAG="${QA_PREV_TAG:-v3.0.0-beta.1}"
QA_BRANCH="${QA_BRANCH:-qa/pre-prod-2026-10-04}"
APP_DIR="$BENCH/apps/ury"
EVID="$APP_DIR/qa/evidence/cat02"
mkdir -p "$EVID"

# ---- guard ---------------------------------------------------------------
for prod in portal.smartchoice-iq.com demo.smarterp.com demo.smart_chat.com; do
	if [ -d "$BENCH/sites/$prod" ]; then echo "REFUSED: $BENCH hosts production site $prod"; exit 2; fi
done
for s in "$SITE" "$UPGRADE_SITE" "$UNINSTALL_SITE"; do
	case "$s" in qa*.localhost) ;; *) echo "REFUSED: $s is not a qa*.localhost site"; exit 2 ;; esac
done
: "${QA_DB_ROOT_PASSWORD:?set QA_DB_ROOT_PASSWORD}" "${QA_ADMIN_PASSWORD:?set QA_ADMIN_PASSWORD}"

cd "$BENCH" || exit 2
RESULT=0
pass() { echo "[PASS] $*" | tee -a "$EVID/summary.txt"; }
fail() { echo "[FAIL] $*" | tee -a "$EVID/summary.txt"; RESULT=1; }
errors_in() { grep -inE "traceback|error:|exception|failed" "$1" | grep -viE "0 errors|error log" ; }

make_site() {  # $1 site
	if [ -d "sites/$1" ]; then
		if [ "${QA_RECREATE:-0}" = "1" ]; then
			bench drop-site "$1" --db-root-password "$QA_DB_ROOT_PASSWORD" --no-backup --force
		else
			echo "$1 exists; set QA_RECREATE=1 to recreate"; return 1
		fi
	fi
	bench new-site "$1" --db-root-password "$QA_DB_ROOT_PASSWORD" --admin-password "$QA_ADMIN_PASSWORD" --install-app erpnext
}

: > "$EVID/summary.txt"

# ---- 2.1 fresh install -------------------------------------------------------
git -C "$APP_DIR" checkout "$QA_BRANCH"
make_site "$SITE" > "$EVID/2.1_new_site.log" 2>&1 || fail "2.1 new-site failed (see 2.1_new_site.log)"
bench --site "$SITE" install-app ury > "$EVID/2.1_install_ury.log" 2>&1
if [ $? -eq 0 ] && [ -z "$(errors_in "$EVID/2.1_install_ury.log")" ]; then pass "2.1 install-app ury"; else fail "2.1 install-app ury (see 2.1_install_ury.log)"; fi
bench --site "$SITE" execute frappe.db.count --args "['Error Log']" > "$EVID/2.1_error_log_count.txt" 2>&1

# ---- 2.2 migrate twice --------------------------------------------------------
bench --site "$SITE" migrate > "$EVID/2.2_migrate_1.log" 2>&1 || fail "2.2 first migrate exited non-zero"
P1=$(bench --site "$SITE" execute frappe.db.count --args "['Patch Log']" 2>/dev/null | tail -1)
bench --site "$SITE" migrate > "$EVID/2.2_migrate_2.log" 2>&1 || fail "2.2 second migrate exited non-zero"
P2=$(bench --site "$SITE" execute frappe.db.count --args "['Patch Log']" 2>/dev/null | tail -1)
if [ "$P1" = "$P2" ] && ! grep -q "Executing ury.patches" "$EVID/2.2_migrate_2.log"; then
	pass "2.2 second migrate is a no-op (Patch Log $P1 -> $P2)"
else
	fail "2.2 second migrate ran patches (Patch Log $P1 -> $P2)"
fi

# ---- 2.4 fixtures --------------------------------------------------------------
bench --site "$SITE" execute ury.tests.qa_seed.fixtures_report --kwargs "{'expect': 'present'}" > "$EVID/2.4_fixtures.json" 2>&1
grep -q '"ok": true' "$EVID/2.4_fixtures.json" && pass "2.4 fixtures present" || fail "2.4 fixtures missing (see 2.4_fixtures.json)"

# ---- 2.3 upgrade from PREV_TAG -------------------------------------------------
git -C "$APP_DIR" checkout --quiet "$PREV_TAG" || { fail "2.3 cannot checkout $PREV_TAG"; }
make_site "$UPGRADE_SITE" > "$EVID/2.3_new_site.log" 2>&1
bench --site "$UPGRADE_SITE" install-app ury > "$EVID/2.3_install_prev.log" 2>&1 || fail "2.3 install of $PREV_TAG failed"
# Sample data through frappe.client.insert only (no dependency on code that may not exist at PREV_TAG).
COMPANY=$(bench --site "$UPGRADE_SITE" execute frappe.db.get_value --args "['Company', {}, 'name']" 2>/dev/null | tail -1 | tr -d '"')
ins() { bench --site "$UPGRADE_SITE" execute frappe.client.insert --kwargs "{'doc': $1}" >> "$EVID/2.3_seed.log" 2>&1; }
ins "{'doctype':'Branch','branch':'_QA Up Branch'}"
ins "{'doctype':'URY Room','name':'_QA Up Room','branch':'_QA Up Branch'}"
ins "{'doctype':'URY Restaurant','name':'_QA Up Rest','company':'$COMPANY','invoice_series_prefix':'QAUP','branch':'_QA Up Branch','default_room':'_QA Up Room'}"
for t in 1 2 3; do ins "{'doctype':'URY Table','name':'_QA Up T$t','restaurant':'_QA Up Rest','restaurant_room':'_QA Up Room','branch':'_QA Up Branch'}"; done
for dt in "URY Table" "URY Room" "URY Restaurant" "Branch" "Custom Field"; do
	echo "$dt=$(bench --site "$UPGRADE_SITE" execute frappe.db.count --args "['$dt']" 2>/dev/null | tail -1)"
done > "$EVID/2.3_counts_before.txt"
git -C "$APP_DIR" checkout --quiet "$QA_BRANCH"
bench --site "$UPGRADE_SITE" migrate > "$EVID/2.3_migrate_upgrade.log" 2>&1 || fail "2.3 upgrade migrate exited non-zero"
for dt in "URY Table" "URY Room" "URY Restaurant" "Branch" "Custom Field"; do
	echo "$dt=$(bench --site "$UPGRADE_SITE" execute frappe.db.count --args "['$dt']" 2>/dev/null | tail -1)"
done > "$EVID/2.3_counts_after.txt"
# Business data must survive; Custom Field may only grow.
if diff <(grep -v "Custom Field" "$EVID/2.3_counts_before.txt") <(grep -v "Custom Field" "$EVID/2.3_counts_after.txt") > /dev/null \
	&& [ -z "$(errors_in "$EVID/2.3_migrate_upgrade.log")" ]; then
	pass "2.3 upgrade $PREV_TAG -> $QA_BRANCH keeps data"
else
	fail "2.3 upgrade changed data or logged errors (see 2.3_*)"
fi

# ---- 2.5 uninstall -------------------------------------------------------------
make_site "$UNINSTALL_SITE" > "$EVID/2.5_new_site.log" 2>&1
bench --site "$UNINSTALL_SITE" install-app ury > "$EVID/2.5_install.log" 2>&1
bench --site "$UNINSTALL_SITE" uninstall-app ury --yes --no-backup > "$EVID/2.5_uninstall.log" 2>&1 || fail "2.5 uninstall-app failed"
bench --site "$UNINSTALL_SITE" migrate > "$EVID/2.5_migrate_after.log" 2>&1 || fail "2.5 site does not migrate after uninstall"
# qa_seed is gone with the app; check the fixture leftovers by name with plain frappe calls.
python3 - "$APP_DIR/ury/fixtures/custom_field.json" > "$EVID/2.5_fixture_names.txt" <<'EOF'
import json, sys
print("\n".join(d["name"] for d in json.load(open(sys.argv[1]))))
EOF
LEFT=0
while read -r cf; do
	n=$(bench --site "$UNINSTALL_SITE" execute frappe.db.exists --args "['Custom Field', '$cf']" 2>/dev/null | tail -1)
	if [ -n "$n" ] && [ "$n" != "None" ]; then echo "$cf" >> "$EVID/2.5_orphans.txt"; LEFT=$((LEFT+1)); fi
done < "$EVID/2.5_fixture_names.txt"
[ "$LEFT" -eq 0 ] && pass "2.5 no orphaned custom fields" || fail "2.5 $LEFT orphaned custom fields (2.5_orphans.txt)"
curl -s -o /dev/null -w "%{http_code}" -H "Host: $UNINSTALL_SITE" "http://127.0.0.1:${QA_HTTP_PORT:-8000}/app/pos-invoice" > "$EVID/2.5_http_after.txt"
grep -qE "^(200|302|303)$" "$EVID/2.5_http_after.txt" && pass "2.5 site responds after uninstall" || fail "2.5 site broken after uninstall"

echo "---"; cat "$EVID/summary.txt"
exit $RESULT
