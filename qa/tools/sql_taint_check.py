#!/usr/bin/env python3
"""Static SQL-injection triage for frappe.db.sql call sites (read-only, no site needed).

Lists every frappe.db.sql whose query text is built dynamically (f-string, %, +, .format, or a
variable), and flags those where an interpolated name is a parameter of the enclosing function or
is assigned from one (three rounds of one-hop propagation). Flagged sites still need a human look:
a fragment *chosen* by a parameter but itself constant is safe.

    python3 qa/tools/sql_taint_check.py > qa/evidence/static/sql_taint.txt
"""

import ast
import pathlib

APP = pathlib.Path(__file__).resolve().parents[2] / "ury"


def _names(node):
	return {x.id for x in ast.walk(node) if isinstance(x, ast.Name)}


def _interpolated(query):
	if isinstance(query, ast.JoinedStr):
		return set().union(
			*[_names(v.value) for v in query.values if isinstance(v, ast.FormattedValue)] or [set()]
		)
	if isinstance(query, ast.Call):
		return set().union(*[_names(a) for a in query.args], *[_names(k.value) for k in query.keywords])
	if isinstance(query, ast.BinOp):
		return _names(query.right)
	if isinstance(query, ast.Name):
		return {query.id}
	return set()


def _is_dynamic(query):
	return isinstance(query, (ast.JoinedStr, ast.BinOp, ast.Name)) or (
		isinstance(query, ast.Call) and ast.unparse(query.func).endswith(".format")
	)


def main():
	total, flagged = 0, []
	for path in sorted(APP.rglob("*.py")):
		if path.name.startswith("test_") or "node_modules" in path.parts:
			continue
		tree = ast.parse(path.read_text())
		for fn in (n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)):
			tainted = {a.arg for a in fn.args.args + fn.args.kwonlyargs}
			for _ in range(3):
				for n in ast.walk(fn):
					if isinstance(n, ast.Assign) and _names(n.value) & tainted:
						for target in n.targets:
							tainted |= _names(target)
			for n in ast.walk(fn):
				if isinstance(n, ast.Call) and ast.unparse(n.func).endswith("db.sql") and n.args:
					if not _is_dynamic(n.args[0]):
						continue
					total += 1
					bad = _interpolated(n.args[0]) & tainted
					if bad:
						flagged.append(f"{path.relative_to(APP.parent)}:{n.lineno}\t{fn.name}\t{sorted(bad)}")
	print(f"dynamic frappe.db.sql call sites: {total}")
	print(f"with parameter-derived fragments (review by hand): {len(flagged)}")
	for line in flagged:
		print("  " + line)


if __name__ == "__main__":
	main()
