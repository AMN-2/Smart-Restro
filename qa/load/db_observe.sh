#!/usr/bin/env bash
# QA Cat. 13 — MariaDB observation around the load run. QA SERVER ONLY.
#   ./db_observe.sh start   -> enable slow_query_log (>= 0.2 s) + log_queries_not_using_indexes
#   ./db_observe.sh stop    -> disable, then digest the slow log and list missing-index candidates
# Env: QA_DB_ROOT_PASSWORD, QA_DB_NAME (db_name of qa1 from sites/qa1.localhost/site_config.json)
set -euo pipefail
for prod in portal.smartchoice-iq.com demo.smarterp.com demo.smart_chat.com; do
	[ -d "${QA_BENCH:-$HOME/frappe-bench}/sites/$prod" ] && { echo "REFUSED: production bench"; exit 2; }
done
: "${QA_DB_ROOT_PASSWORD:?}" "${QA_DB_NAME:?}"
EVID="$(cd "$(dirname "$0")/.." && pwd)/evidence/cat13"; mkdir -p "$EVID"
SQL() { mysql -uroot -p"$QA_DB_ROOT_PASSWORD" -N -e "$1"; }
SLOW=/tmp/qa_slow.log

case "${1:-}" in
start)
	SQL "SET GLOBAL slow_query_log_file='$SLOW'; SET GLOBAL long_query_time=0.2; SET GLOBAL log_queries_not_using_indexes=ON; SET GLOBAL slow_query_log=ON;"
	SQL "SHOW GLOBAL STATUS LIKE 'Questions'; SHOW GLOBAL STATUS LIKE 'Slow_queries';" > "$EVID/db_status_before.txt"
	echo "slow log on -> $SLOW"
	;;
stop)
	SQL "SET GLOBAL slow_query_log=OFF; SET GLOBAL log_queries_not_using_indexes=OFF;"
	SQL "SHOW GLOBAL STATUS LIKE 'Questions'; SHOW GLOBAL STATUS LIKE 'Slow_queries';" > "$EVID/db_status_after.txt"
	sudo cp "$SLOW" "$EVID/slow.log" 2>/dev/null || cp "$SLOW" "$EVID/slow.log"
	if command -v pt-query-digest >/dev/null; then
		pt-query-digest "$EVID/slow.log" > "$EVID/slow_digest.txt"
	else
		mysqldumpslow -s t -t 30 "$EVID/slow.log" > "$EVID/slow_digest.txt"
	fi
	# Columns the app filters on that have no index (candidates, not verdicts)
	SQL "SELECT c.TABLE_NAME, c.COLUMN_NAME FROM information_schema.COLUMNS c
	     LEFT JOIN information_schema.STATISTICS s ON s.TABLE_SCHEMA=c.TABLE_SCHEMA AND s.TABLE_NAME=c.TABLE_NAME AND s.COLUMN_NAME=c.COLUMN_NAME
	     WHERE c.TABLE_SCHEMA='$QA_DB_NAME' AND s.INDEX_NAME IS NULL
	       AND ((c.TABLE_NAME='tabPOS Invoice' AND c.COLUMN_NAME IN ('restaurant_table','branch','pos_profile','invoice_printed','status','posting_date','waiter','custom_ury_order_number','order_type','consolidated_invoice'))
	         OR (c.TABLE_NAME='tabURY KOT' AND c.COLUMN_NAME IN ('invoice','branch','production','order_status','verified','creation','type'))
	         OR (c.TABLE_NAME='tabURY Table' AND c.COLUMN_NAME IN ('branch','occupied','restaurant_room'))
	         OR (c.TABLE_NAME='tabURY User' AND c.COLUMN_NAME IN ('user'))
	         OR (c.TABLE_NAME='tabURY Sync Request' AND c.COLUMN_NAME IN ('request_id'))
	         OR (c.TABLE_NAME='tabURY Ordering Session' AND c.COLUMN_NAME IN ('token_hash','status')))" > "$EVID/missing_index_candidates.txt"
	echo "digest -> $EVID/slow_digest.txt ; index candidates -> $EVID/missing_index_candidates.txt"
	;;
*) echo "usage: $0 start|stop"; exit 1 ;;
esac
