"""Minimal public server for one Archify artifact at one random URL."""

from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def make_handler(artifact: Path, token: str):
    route = f"/{token}"

    class ArtifactHandler(BaseHTTPRequestHandler):
        server_version = "SmartRestroArchitecture/1.0"

        def do_GET(self):
            self._serve(send_body=True)

        def do_HEAD(self):
            self._serve(send_body=False)

        def _serve(self, *, send_body: bool):
            path = self.path.split("?", 1)[0].rstrip("/")
            if path != route:
                self.send_error(404)
                return

            payload = artifact.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            if send_body:
                self.wfile.write(payload)

        def log_message(self, format, *args):
            super().log_message(format, *args)

    return ArtifactHandler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--instance", required=True)
    args = parser.parse_args()

    artifact = Path(args.artifact).resolve(strict=True)
    server = ThreadingHTTPServer(("0.0.0.0", args.port), make_handler(artifact, args.token))
    server.serve_forever()


if __name__ == "__main__":
    main()
