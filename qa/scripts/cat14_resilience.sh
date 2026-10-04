#!/usr/bin/env bash
# QA Cat. 14 — resilience & operations. QA SERVER ONLY (restarts services).
#
#   14.1 Redis (cache + queue) restart during live ordering        -> orders recover, integrity_report clean
#   14.2 MariaDB restart during live ordering                       -> no half-written orders
#   14.3 Worker killed mid-job (stock consumption / KOT validation) -> job retried or reported, no corruption
#   14.4 Backup -> restore to a fresh site -> counts identical, app works
#   14.5 Error Log + scheduler clean after the whole run; bench doctor
#
# Traffic during 14.1-14.3 is produced by the Cat. 8 script in a loop (background).
# Env: QA_BENCH, QA_SITE_1, QA_RESTORE_SITE (qa-restore.localhost), QA_DB_ROOT_PASSWORD, QA_ADMIN_PASSWORD,
#      QA_SUPERVISOR_PREFIX (default frappe-bench), QA_PY (default ~/qa-tools/venv/bin/python)
set -uo pipefail
BENCH="${QA_BENCH:-$HOME/frappe-bench}"
SITE="${QA_SITE_1:-qa1.localhost}"
RESTORE_SITE="${QA_RESTORE_SITE:-qa-restore.localhost}"
SUP="${QA_SUPERVISOR_PREFIX:-frappe-bench}"
PY="${QA_PY:-$HOME/qa-tools/venv/bin/python}"
APP_DIR="$BENCH/apps/ury"
EVID="$APP_DIR/qa/evidence/cat14"
mkdir -p "$EVID"

for prod in portal.smartchoice-iq.com demo.smarterp.com demo.smart_chat.com; do
	[ -d "$BENCH/sites/$prod" ] && { echo "REFUSED: $BENCH hosts production site $prod"; exit 2; }
done
case "$SITE$RESTORE_SITE" in qa*.localhostqa*.localhost) ;; *) echo "REFUSED: non-QA site"; exit 2 ;; esac
: "${QA_DB_ROOT_PASSWORD:?}" "${QA_ADMIN_PASSWORD:?}"
cd "$BENCH" || exit 2

RESULT=0
: > "$EVID/summary.txt"
pass() { echo "[PASS] $*" | tee -a "$EVID/summary.txt"; }
fail() { echo "[FAIL] $*" | tee -a "$EVID/summary.txt"; RESULT=1; }
START=$(date '+%Y-%m-%d %H:%M:%S')
integrity() {  # $1 label
	bench --site "$SITE" execute ury.tests.qa_seed.integrity_report --kwargs "{'since': '$START'}" > "$EVID/$1_integrity.json" 2>&1
	grep -q '"ok": true' "$EVID/$1_integrity.json" && pass "$1 integrity" || fail "$1 integrity (see $1_integrity.json)"
}
traffic_on() {
	( while true; do "$PY" "$APP_DIR/qa/scripts/cat08_concurrency.py" >> "$EVID/traffic.log" 2>&1; sleep 1; done ) &
	TRAFFIC_PID=$!
	sleep 10
}
traffic_off() { kill "$TRAFFIC_PID" 2>/dev/null; wait "$TRAFFIC_PID" 2>/dev/null; sleep 5; }

# 14.1 Redis
traffic_on
sudo supervisorctl restart "$SUP-redis:$SUP-redis-cache" "$SUP-redis:$SUP-redis-queue" > "$EVID/14.1_restart.log" 2>&1 \
	|| sudo supervisorctl restart all-redis >> "$EVID/14.1_restart.log" 2>&1
sleep 20
traffic_off
integrity "14.1_redis"

# 14.2 MariaDB
traffic_on
sudo systemctl restart mariadb > "$EVID/14.2_restart.log" 2>&1
sleep 30
traffic_off
integrity "14.2_mariadb"

# 14.3 worker crash mid-job
traffic_on
for p in $(pgrep -f "frappe.utils.bench_helper frappe worker" | head -2); do kill -9 "$p"; done
echo "killed workers at $(date)" > "$EVID/14.3_kill.log"
sleep 90   # supervisor restarts them; the per-minute KOT validation cron must catch up
traffic_off
integrity "14.3_worker"
bench --site "$SITE" execute frappe.db.sql --args "[\"SELECT status, COUNT(*) FROM \`tabURY Consumption Log\` GROUP BY status\"]" > "$EVID/14.3_consumption_status.txt" 2>&1

# 14.4 backup -> restore
bench --site "$SITE" execute ury.tests.qa_seed.counts_snapshot > "$EVID/14.4_counts_source.json" 2>&1
bench --site "$SITE" backup --with-files > "$EVID/14.4_backup.log" 2>&1 || fail "14.4 backup failed"
DB=$(ls -t "sites/$SITE/private/backups/"*-database.sql.gz | head -1)
PUB=$(ls -t "sites/$SITE/private/backups/"*-files.tar | head -1)
PRIV=$(ls -t "sites/$SITE/private/backups/"*-private-files.tar | head -1)
[ -d "sites/$RESTORE_SITE" ] && bench drop-site "$RESTORE_SITE" --db-root-password "$QA_DB_ROOT_PASSWORD" --no-backup --force
bench new-site "$RESTORE_SITE" --db-root-password "$QA_DB_ROOT_PASSWORD" --admin-password "$QA_ADMIN_PASSWORD" > "$EVID/14.4_new_site.log" 2>&1
bench --site "$RESTORE_SITE" restore "$DB" --with-public-files "$PUB" --with-private-files "$PRIV" \
	--db-root-password "$QA_DB_ROOT_PASSWORD" > "$EVID/14.4_restore.log" 2>&1 || fail "14.4 restore failed"
bench --site "$RESTORE_SITE" migrate > "$EVID/14.4_migrate.log" 2>&1
# counts_snapshot guards on the site name; allow the restore site for this one call
QA_ALLOWED_SITES="$RESTORE_SITE" bench --site "$RESTORE_SITE" execute ury.tests.qa_seed.counts_snapshot > "$EVID/14.4_counts_restored.json" 2>&1
if diff <(tail -1 "$EVID/14.4_counts_source.json") <(tail -1 "$EVID/14.4_counts_restored.json") > "$EVID/14.4_diff.txt"; then
	pass "14.4 restore complete (counts + money total identical)"
else
	fail "14.4 restored site differs (14.4_diff.txt)"
fi

# 14.5 hygiene
bench doctor > "$EVID/14.5_doctor.txt" 2>&1
bench --site "$SITE" execute frappe.db.sql --args "[\"SELECT method, COUNT(*) n FROM \`tabError Log\` WHERE creation >= '$START' GROUP BY method ORDER BY n DESC\"]" > "$EVID/14.5_error_log.txt" 2>&1
bench --site "$SITE" execute frappe.db.sql --args "[\"SELECT scheduled_job_type, status, COUNT(*) FROM \`tabScheduled Job Log\` WHERE creation >= '$START' GROUP BY 1,2\"]" > "$EVID/14.5_scheduler.txt" 2>&1
grep -q "Failed" "$EVID/14.5_scheduler.txt" && fail "14.5 scheduler has failed jobs" || pass "14.5 scheduler clean"
echo "Error Log since $START:"; cat "$EVID/14.5_error_log.txt"

echo "---"; cat "$EVID/summary.txt"
exit $RESULT
