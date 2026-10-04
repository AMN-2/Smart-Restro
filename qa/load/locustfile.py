"""QA Cat. 13 — peak-hour load: 40 POS users + KDS pollers, 15 minutes. QA SERVER ONLY.

Seed first (once):
  bench --site qa1.localhost execute ury.tests.qa_seed.seed_load > qa/evidence/load_manifest.json

Run (headless, CSV per endpoint):
  QA_URL_1=http://qa1.localhost:8000 ~/qa-tools/venv/bin/locust -f qa/load/locustfile.py \
    --headless -u 48 -r 4 -t 15m --csv qa/evidence/cat13/locust --html qa/evidence/cat13/report.html \
    --host "$QA_URL_1"
  (-u 48 = 40 POSUser + 8 KDSUser by the weights below)

Every POS user works its own two tables, so the load is realistic contention
(shared menu, shared naming series, shared KOT pipeline) without two users
fighting over one table — Cat. 8 covers that on purpose.

Thresholds (from the QA brief): p95 < 500 ms on order/payment endpoints, 0 % errors.
"""

import itertools
import json
import os
import random
import re
import sys
import threading
import urllib.parse

from locust import HttpUser, between, events, task

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
from qa_env import guard

MANIFEST = os.environ.get(
	"QA_LOAD_MANIFEST",
	os.path.join(
		os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "evidence", "load_manifest.json"
	),
)
ORDER_PAYMENT = ("sync_order", "make_invoice")


def _manifest():
	with open(MANIFEST) as fh:
		text = fh.read()
	return json.loads(text[text.index("{") :])


M = None
POS_SLOTS = None
_lock = threading.Lock()


@events.init.add_listener
def _init(environment, **_kw):
	global M, POS_SLOTS
	guard(environment.host or os.environ.get("QA_URL_1", ""))
	M = _manifest()
	POS_SLOTS = itertools.cycle(M["users"])


@events.quitting.add_listener
def _thresholds(environment, **_kw):
	bad = []
	for name, entry in environment.stats.entries.items():
		label = name[0]
		if entry.num_failures:
			bad.append(f"{label}: {entry.num_failures} failures")
		if any(k in label for k in ORDER_PAYMENT) and entry.get_response_time_percentile(0.95) > 500:
			bad.append(f"{label}: p95 {entry.get_response_time_percentile(0.95):.0f} ms > 500 ms")
	if bad:
		print("THRESHOLD FAILURES:\n  " + "\n  ".join(bad))
		environment.process_exit_code = 1


class _FrappeUser(HttpUser):
	abstract = True

	def _login(self, usr, pwd):
		site = urllib.parse.urlparse(self.host).hostname
		self.client.headers["Host"] = site
		self.client.post("/api/method/login", data={"usr": usr, "pwd": pwd}, name="login")
		r = self.client.get("/pos", name="csrf")
		m = re.search(r"csrf_token[\"']?\s*[:=]\s*[\"']([0-9a-f]{20,})[\"']", r.text)
		self.csrf = m.group(1) if m else ""

	def m(self, method, name=None, http="POST", **params):
		data = {
			k: (json.dumps(v) if isinstance(v, (list, dict)) else v)
			for k, v in params.items()
			if v is not None
		}
		label = name or method.rsplit(".", 1)[1]
		with self.client.request(
			http,
			f"/api/method/{method}",
			data=data if http == "POST" else None,
			params=data if http == "GET" else None,
			headers={"X-Frappe-CSRF-Token": self.csrf, "Accept": "application/json"},
			name=label,
			catch_response=True,
		) as r:
			if r.status_code != 200:
				r.failure(f"{r.status_code}: {r.text[:200]}")
				return None
			try:
				return r.json().get("message")
			except ValueError:
				r.failure("non-JSON response")
				return None


class POSUser(_FrappeUser):
	weight = 5
	wait_time = between(2, 6)

	def on_start(self):
		with _lock:
			slot = next(POS_SLOTS)
		self.me = slot
		self.world = M["worlds"][slot["branch"]]
		self._login(slot["user"], M["password"])
		self.m("ury.ury_pos.api.getPosProfile")
		self.m(
			"ury.ury_pos.api.getRestaurantMenu", pos_profile=self.world["profile"], room=self.world["room"]
		)
		self.open = {}  # table -> (invoice, cart)

	def _items(self):
		return [
			{"item": c, "item_name": c, "qty": random.randint(1, 3), "comment": ""}
			for c in random.sample(M["items"], random.randint(1, 4))
		]

	@task(6)
	def take_or_add_order(self):
		table = random.choice(self.me["tables"])
		inv, cart = self.open.get(table, (None, []))
		cart = cart + self._items()  # the POS resends the whole cart on every send
		res = self.m(
			"ury.ury.doctype.ury_order.ury_order.sync_order",
			name="sync_order",
			items=cart,
			cashier=self.me["user"],
			owner=self.me["user"],
			mode_of_payment=self.world["cash"],
			customer=self.world["customer"],
			no_of_pax=2,
			last_invoice=inv,
			waiter=self.me["user"],
			pos_profile=self.world["profile"],
			table=table,
			invoice=inv,
			room=self.world["room"],
			request_id=f"{self.me['user']}-{random.random()}",
		)
		if isinstance(res, dict) and res.get("name"):
			self.open[table] = (res["name"], cart)

	@task(3)
	def settle(self):
		if not self.open:
			return
		table, (inv, _cart) = random.choice(list(self.open.items()))
		total = None
		ctx = self.m("ury.ury.doctype.ury_order.ury_order.get_order_invoice", invoiceNo=inv, table=table)
		if isinstance(ctx, dict):
			total = ctx.get("rounded_total") or ctx.get("grand_total")
		if not total:
			self.open.pop(table, None)
			return
		self.m(
			"ury.ury.doctype.ury_order.ury_order.make_invoice",
			name="make_invoice",
			customer=self.world["customer"],
			payments=[{"mode_of_payment": self.world["cash"], "amount": total}],
			cashier=self.me["user"],
			pos_profile=self.world["profile"],
			owner=self.me["user"],
			invoice=inv,
			table=table,
		)
		self.open.pop(table, None)

	@task(4)
	def browse(self):
		self.m("ury.ury_pos.api.getPosInvoice", status="Draft", limit=20, limit_start=0)

	@task(1)
	def search(self):
		self.m("ury.ury_pos.api.searchPosInvoice", query=random.choice(["QA", "L1", "1"]), status="Paid")

	@task(1)
	def bill_lines(self):
		if self.open:
			self.m("ury.ury_pos.api.getPosInvoiceItems", invoice=random.choice(list(self.open.values()))[0])


class KDSUser(_FrappeUser):
	"""Kitchen screen: polls the board like the KDS does after a realtime ping."""

	weight = 1
	wait_time = between(3, 5)

	def on_start(self):
		with _lock:
			slot = next(POS_SLOTS)
		self._login(slot["user"], M["password"])

	@task
	def board(self):
		self.m("ury.ury.api.ury_kot_display.kot_list", http="GET")
