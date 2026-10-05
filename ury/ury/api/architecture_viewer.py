"""Start and stop the temporary public Archify viewer from Frappe."""

from __future__ import annotations

import fcntl
import json
import os
import secrets
import signal
import socket
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

import frappe
from frappe import _

PORT = 8080
CONTROL_ROLES = {"Administrator", "System Manager", "URY Admin"}
STATE_FILE = "state.json"
LOCK_FILE = "control.lock"
LOG_FILE = "server.log"


def _require_control_role():
    if frappe.session.user == "Guest" or not CONTROL_ROLES.intersection(frappe.get_roles()):
        frappe.throw(_("Not permitted"), frappe.PermissionError)


def _control_dir() -> Path:
    directory = Path(frappe.get_site_path("private", "architecture_viewer"))
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    return directory


@contextmanager
def _control_lock():
    path = _control_dir() / LOCK_FILE
    with path.open("a+", encoding="utf-8") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        yield


def _read_state() -> dict | None:
    path = _control_dir() / STATE_FILE
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    return value if isinstance(value, dict) else None


def _write_state(state: dict):
    path = _control_dir() / STATE_FILE
    candidate = path.with_suffix(".tmp")
    candidate.write_text(json.dumps(state, separators=(",", ":")), encoding="utf-8")
    os.chmod(candidate, 0o600)
    candidate.replace(path)


def _clear_state():
    try:
        (_control_dir() / STATE_FILE).unlink()
    except FileNotFoundError:
        pass


def _artifact_path() -> Path:
    app_root = Path(frappe.get_app_path("ury")).resolve().parent
    configured = (frappe.conf.get("architecture_viewer_artifact") or "").strip()
    if configured:
        artifact = (app_root / configured).resolve()
        if app_root not in artifact.parents:
            frappe.throw(_("Architecture artifact must be inside the URY app"))
        if not artifact.is_file():
            frappe.throw(_("Architecture artifact was not found"))
        return artifact

    candidates = list(app_root.glob(".archify/architecture-smart-restro-*/smart-restro-architecture.html"))
    if not candidates:
        frappe.throw(_("No generated Smart Restro architecture artifact was found"))
    return max(candidates, key=lambda path: path.stat().st_mtime).resolve()


def _process_matches(state: dict) -> bool:
    try:
        pid = int(state["pid"])
        token = str(state["token"])
        os.kill(pid, 0)
        cmdline = Path(f"/proc/{pid}/cmdline").read_bytes().decode(errors="replace")
    except (KeyError, TypeError, ValueError, ProcessLookupError, PermissionError, FileNotFoundError, OSError):
        return False
    return "architecture_viewer_server.py" in cmdline and token in cmdline


def _port_available() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("0.0.0.0", PORT))
        except OSError:
            return False
    return True


def _public_state(state: dict | None) -> dict:
    running = bool(state and _process_matches(state))
    return {
        "running": running,
        "port": PORT,
        "path": f"/{state['token']}/" if running else None,
        "started_at": state.get("started_at") if running else None,
        "started_by": state.get("started_by") if running else None,
    }


@frappe.whitelist(methods=["GET", "POST"])
def status():
    _require_control_role()
    with _control_lock():
        state = _read_state()
        if state and not _process_matches(state):
            _clear_state()
            state = None
        return _public_state(state)


@frappe.whitelist(methods=["POST"])
def start():
    _require_control_role()
    with _control_lock():
        existing = _read_state()
        if existing and _process_matches(existing):
            return _public_state(existing)
        _clear_state()
        if not _port_available():
            frappe.throw(_("Port {0} is already in use").format(PORT))

        artifact = _artifact_path()
        token = secrets.token_urlsafe(24)
        server_script = Path(__file__).with_name("architecture_viewer_server.py")
        log_path = _control_dir() / LOG_FILE
        log = log_path.open("ab", buffering=0)
        try:
            process = subprocess.Popen(
                [
                    sys.executable,
                    str(server_script),
                    "--artifact",
                    str(artifact),
                    "--token",
                    token,
                    "--port",
                    str(PORT),
                    "--instance",
                    token,
                ],
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                close_fds=True,
                start_new_session=True,
            )
        finally:
            log.close()

        deadline = time.monotonic() + 3
        while time.monotonic() < deadline and process.poll() is None:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.settimeout(0.15)
                if probe.connect_ex(("127.0.0.1", PORT)) == 0:
                    break
            time.sleep(0.05)
        else:
            if process.poll() is None:
                process.terminate()
            frappe.throw(_("Architecture viewer could not be started; check {0}").format(log_path))

        state = {
            "pid": process.pid,
            "token": token,
            "started_at": frappe.utils.now_datetime().isoformat(),
            "started_by": frappe.session.user,
            "artifact": str(artifact),
        }
        try:
            _write_state(state)
        except Exception:
            process.terminate()
            raise
        return _public_state(state)


@frappe.whitelist(methods=["POST"])
def stop():
    _require_control_role()
    with _control_lock():
        state = _read_state()
        if not state or not _process_matches(state):
            _clear_state()
            return _public_state(None)

        pid = int(state["pid"])
        os.kill(pid, signal.SIGTERM)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if not _process_matches(state):
                break
            time.sleep(0.05)
        if _process_matches(state):
            os.kill(pid, signal.SIGKILL)
        _clear_state()
        return _public_state(None)
