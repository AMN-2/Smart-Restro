"""Shared harness for the HTTP / Socket.IO QA scripts (Cat. 6, 7, 8, 12, 13).

Safety first: `guard()` refuses to run
  * on any machine whose bench contains a known production site directory
    (this is how the script recognises the production server), and
  * against any base URL whose host is not on the QA allow-list.

Configuration (environment):
  QA_SITE_1 / QA_URL_1   default qa1.localhost / http://qa1.localhost:8000
  QA_SITE_2 / QA_URL_2   default qa2.localhost / http://qa2.localhost:8000
  QA_SOCKET_URL_1/_2     default http://<host>:9000   (bench socketio port)
  QA_BENCH               default ~/frappe-bench       (only used by the guard)
  QA_ALLOWED_HOSTS       extra comma-separated hosts

World data (users, tables, profiles) comes from
  bench --site <site> execute ury.tests.qa_seed.seed_worlds > qa/evidence/world_<site>.json
"""

import json
import os
import re
import sys
import time
import urllib.parse

import requests

ALLOWED_HOSTS = {"qa1.localhost", "qa2.localhost", "127.0.0.1", "localhost"} | {
	h.strip() for h in os.environ.get("QA_ALLOWED_HOSTS", "").split(",") if h.strip()
}
PRODUCTION_SITES = {"portal.smartchoice-iq.com", "demo.smarterp.com", "demo.smart_chat.com"}
EVIDENCE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "evidence")

SITE_1 = os.environ.get("QA_SITE_1", "qa1.localhost")
SITE_2 = os.environ.get("QA_SITE_2", "qa2.localhost")
URL_1 = os.environ.get("QA_URL_1", f"http://{SITE_1}:8000")
URL_2 = os.environ.get("QA_URL_2", f"http://{SITE_2}:8000")


def guard(*urls):
	bench = os.path.expanduser(os.environ.get("QA_BENCH", "~/frappe-bench"))
	for site in PRODUCTION_SITES:
		if os.path.isdir(os.path.join(bench, "sites", site)):
			sys.exit(f"REFUSED: {bench} hosts production site {site}. QA scripts run only on the QA server.")
	for url in urls or (URL_1, URL_2):
		host = urllib.parse.urlparse(url).hostname
		if host not in ALLOWED_HOSTS:
			sys.exit(f"REFUSED: {url} is not a QA host ({sorted(ALLOWED_HOSTS)}).")


def load_world(site):
	path = os.path.join(EVIDENCE, f"world_{site}.json")
	if not os.path.exists(path):
		sys.exit(f"Missing {path}. Run: bench --site {site} execute ury.tests.qa_seed.seed_worlds > {path}")
	with open(path) as fh:
		text = fh.read()
	return json.loads(text[text.index("{") :])


class FrappeClient:
	"""Cookie-session client that behaves like the POS in a browser (CSRF included)."""

	def __init__(self, base_url, site=None, timeout=30):
		guard(base_url)
		self.base = base_url.rstrip("/")
		self.site = site or urllib.parse.urlparse(base_url).hostname
		self.s = requests.Session()
		self.s.headers["Host"] = self.site
		self.timeout = timeout
		self.csrf = None
		self.user = "Guest"

	def login(self, usr, pwd):
		r = self.s.post(f"{self.base}/api/method/login", data={"usr": usr, "pwd": pwd}, timeout=self.timeout)
		r.raise_for_status()
		self.user = usr
		self.csrf = self._fetch_csrf()
		return self

	def _fetch_csrf(self):
		for path in ("/pos", "/app", "/ury"):
			r = self.s.get(f"{self.base}{path}", timeout=self.timeout)
			m = re.search(r"csrf_token[\"']?\s*[:=]\s*[\"']([0-9a-f]{20,})[\"']", r.text)
			if m:
				return m.group(1)
		return None

	def call(self, method, _http="POST", _csrf=True, **params):
		"""Returns (status_code, json_or_text, elapsed_seconds)."""
		url = f"{self.base}/api/method/{method}"
		headers = {"Accept": "application/json"}
		if _csrf and self.csrf:
			headers["X-Frappe-CSRF-Token"] = self.csrf
		data = {
			k: (json.dumps(v) if isinstance(v, (list, dict)) else v)
			for k, v in params.items()
			if v is not None
		}
		t0 = time.perf_counter()
		if _http == "GET":
			r = self.s.get(url, params=data, headers=headers, timeout=self.timeout)
		else:
			r = self.s.post(url, data=data, headers=headers, timeout=self.timeout)
		dt = time.perf_counter() - t0
		try:
			body = r.json()
		except ValueError:
			body = r.text
		return r.status_code, body, dt

	def ok(self, method, **params):
		code, body, _ = self.call(method, **params)
		if code != 200:
			raise RuntimeError(f"{method} -> {code}: {str(body)[:300]}")
		return body.get("message") if isinstance(body, dict) else body

	def get_doc(self, doctype, name):
		r = self.s.get(
			f"{self.base}/api/resource/{urllib.parse.quote(doctype)}/{urllib.parse.quote(name)}",
			timeout=self.timeout,
		)
		return r.status_code, (
			r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text
		)


def socket_url(site_num):
	base = URL_1 if site_num == 1 else URL_2
	default = re.sub(r":\d+$", ":9000", base)
	return os.environ.get(f"QA_SOCKET_URL_{site_num}", default)


def realtime_listener(client, socket_base):
	"""Connected python-socketio client for `client`'s session. Records every event.

	Frappe v15 serves one Socket.IO namespace per site (`/<site>`) and
	authenticates with the `sid` cookie; system users auto-join the site room.
	"""
	import socketio

	guard(socket_base)
	events = []
	sio = socketio.Client(reconnection=True, logger=False)

	@sio.on("*", namespace=f"/{client.site}")
	def _any(event, data=None):
		events.append({"t": time.time(), "event": event, "data": data})

	cookie = "; ".join(f"{k}={v}" for k, v in client.s.cookies.get_dict().items())
	sio.connect(
		socket_base,
		namespaces=[f"/{client.site}"],
		socketio_path="socket.io",
		headers={"Cookie": cookie, "Origin": client.base, "Host": client.site},
		transports=["websocket"],
		wait_timeout=10,
	)
	sio.qa_events = events
	return sio


def write_evidence(name, payload):
	os.makedirs(EVIDENCE, exist_ok=True)
	path = os.path.join(EVIDENCE, name)
	with open(path, "w") as fh:
		json.dump(payload, fh, indent=1, default=str, ensure_ascii=False)
	print(f"evidence -> {path}")
	return path


def order_payload(items):
	return [{"item": c, "item_name": c, "qty": q, "comment": ""} for c, q in items]


def sync_order(client, world, table, items, invoice=None, last_invoice=None, request_id=None, role="cashier"):
	return client.call(
		"ury.ury.doctype.ury_order.ury_order.sync_order",
		items=order_payload(items),
		cashier=world["users"]["cashier"],
		owner=world["users"][role],
		mode_of_payment=world["cash"],
		customer=world["customer"],
		no_of_pax=2,
		last_invoice=last_invoice,
		waiter=world["users"][role],
		pos_profile=world["profile"],
		table=table,
		invoice=invoice,
		room=world["room"],
		request_id=request_id,
	)


def make_invoice(client, world, invoice, payments, table=None, discount=None):
	return client.call(
		"ury.ury.doctype.ury_order.ury_order.make_invoice",
		customer=world["customer"],
		payments=[{"mode_of_payment": m, "amount": a} for m, a in payments],
		cashier=world["users"]["cashier"],
		pos_profile=world["profile"],
		owner=world["users"]["cashier"],
		additionalDiscount=discount,
		table=table,
		invoice=invoice,
	)
