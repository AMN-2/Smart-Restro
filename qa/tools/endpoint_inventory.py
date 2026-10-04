#!/usr/bin/env python3
"""Static inventory of every whitelisted method in the ury app.

Read-only: parses source with `ast`, never imports the app, never touches a
site. Safe to run on any machine.

For each `@frappe.whitelist` function it records the dotted path, guest
access, allowed HTTP methods, parameters, and whether the function body
contains an explicit authorization signal. That last column is a heuristic
(a name-based search, one call deep into same-module helpers): "none" means
"a human must check this endpoint", not "this endpoint is broken". The
generated CSV drives qa/../ury/tests/test_api_contract.py and the role
matrix tests.

Usage:
    python3 qa/tools/endpoint_inventory.py            # writes qa/evidence/endpoints.csv
    python3 qa/tools/endpoint_inventory.py --stdout   # print instead
"""

import ast
import csv
import pathlib
import subprocess
import sys

APP_ROOT = pathlib.Path(__file__).resolve().parents[2]
PKG = APP_ROOT / "ury"
OUT = APP_ROOT / "qa" / "evidence" / "endpoints.csv"

# Names whose presence in a function body counts as an explicit authz signal.
AUTHZ_SIGNALS = (
	"has_permission",
	"check_permission",
	"only_for",
	"require_manager",
	"_require_",
	"_enforce_",
	"_assert_",
	"getBranch",
	"get_roles",
	"_resolve_session",
	"_verify_qr_token",
	"_resolve_device",
	"driver_from_token",
	"read_token",
	"_may_settle",
	"_has_role",
	"validate_access",
	"PermissionError",
)
# Calls that apply Frappe's own permission checks implicitly.
IMPLICIT_PERM_CALLS = ("get_list", "frappe.client.")


def _calls(fn):
	return {ast.unparse(n.func) for n in ast.walk(fn) if isinstance(n, ast.Call)}


def _signal(fn, module_funcs, depth=1):
	src = ast.unparse(fn)
	hits = sorted({s for s in AUTHZ_SIGNALS if s in src})
	if hits:
		return "explicit:" + "|".join(hits)
	if any(c.endswith(IMPLICIT_PERM_CALLS) or c in IMPLICIT_PERM_CALLS for c in _calls(fn)):
		return "implicit:get_list"
	if depth:
		for c in _calls(fn):
			callee = module_funcs.get(c.split(".")[-1])
			if callee is not None and callee is not fn:
				inner = _signal(callee, module_funcs, depth - 1)
				if inner != "none":
					return "via-helper:" + c
	return "none"


def _tracked():
	"""Git-tracked .py files under ury/, or None outside a git checkout.

	Untracked files are someone's work in progress, not the code under test,
	so they are left out of the inventory when git can tell the difference.
	"""
	try:
		out = subprocess.run(
			["git", "-C", str(APP_ROOT), "ls-files", "ury"], capture_output=True, text=True, check=True
		).stdout
	except (OSError, subprocess.CalledProcessError):
		return None
	return {(APP_ROOT / line).resolve() for line in out.splitlines() if line.endswith(".py")}


def inventory():
	rows = []
	tracked = _tracked()
	for path in sorted(PKG.rglob("*.py")):
		if "node_modules" in path.parts or path.name.startswith("test_"):
			continue
		if tracked is not None and path.resolve() not in tracked and "tests" not in path.parts:
			continue
		tree = ast.parse(path.read_text())
		module_funcs = {n.name: n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
		module = ".".join(path.relative_to(APP_ROOT).with_suffix("").parts)
		for fn in module_funcs.values():
			for dec in fn.decorator_list:
				dsrc = ast.unparse(dec)
				if "whitelist" not in dsrc:
					continue
				methods = "ANY"
				if "methods=" in dsrc:
					methods = dsrc.split("methods=")[1].split("]")[0].strip("[ ").replace("'", "")
				params = [a.arg for a in fn.args.args if a.arg != "self"]
				rows.append(
					{
						"method": f"{module}.{fn.name}",
						"guest": "yes" if "allow_guest=True" in dsrc else "no",
						"http_methods": methods,
						"is_doc_method": "yes" if fn.args.args and fn.args.args[0].arg == "self" else "no",
						"rate_limited": "yes"
						if any("rate_limit" in ast.unparse(d) for d in fn.decorator_list)
						else "no",
						"params": " ".join(params),
						"authz_signal": _signal(fn, module_funcs),
						"location": f"{path.relative_to(APP_ROOT)}:{fn.lineno}",
					}
				)
	return rows


def main():
	rows = inventory()
	fields = list(rows[0].keys())
	if "--stdout" in sys.argv:
		w = csv.DictWriter(sys.stdout, fieldnames=fields)
	else:
		OUT.parent.mkdir(parents=True, exist_ok=True)
		fh = OUT.open("w", newline="")
		w = csv.DictWriter(fh, fieldnames=fields)
	w.writeheader()
	w.writerows(rows)
	none = [r for r in rows if r["authz_signal"] == "none"]
	print(
		f"{len(rows)} whitelisted methods, {sum(r['guest'] == 'yes' for r in rows)} guest, "
		f"{len(none)} with no authz signal",
		file=sys.stderr,
	)


if __name__ == "__main__":
	main()
