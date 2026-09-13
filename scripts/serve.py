#!/usr/bin/env python3
"""Static Local Chat server. HTTP for localhost; HTTPS so spark.local is a secure context."""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
CERT_DIR = ROOT / ".dev-certs"


def lan_hostname(raw: str | None = None) -> str:
    candidates = [raw] if raw is not None else [socket.gethostname(), socket.getfqdn()]
    for value in candidates:
        name = str(value or "").strip().lower()
        if name.endswith(".local"):
            name = name[:-6]
        short = re.sub(r"[^a-z0-9-]+", "-", name.split(".")[0]).strip("-")
        if short and short != "localhost":
            return f"{short}.local"
    return ""


def ensure_certs(host: str) -> tuple[Path, Path]:
    cert = CERT_DIR / "cert.pem"
    key = CERT_DIR / "key.pem"
    if cert.exists() and key.exists():
        return cert, key
    CERT_DIR.mkdir(parents=True, exist_ok=True)
    names = ["localhost", "127.0.0.1", "::1"]
    if host:
        names.insert(0, host)
    mkcert = shutil.which("mkcert")
    if mkcert:
        cmd = [mkcert, "-cert-file", str(cert), "-key-file", str(key), *names]
        subprocess.run(cmd, check=True, cwd=CERT_DIR)
        return cert, key
    openssl = shutil.which("openssl")
    if not openssl:
        raise RuntimeError("Need mkcert or openssl to make a TLS cert for spark.local.")
    san = ",".join(
        ([f"DNS:{host}"] if host else [])
        + ["DNS:localhost", "DNS:*.local", "IP:127.0.0.1", "IP:::1"]
    )
    subprocess.run(
        [
            openssl,
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-sha256",
            "-days",
            "825",
            "-nodes",
            "-keyout",
            str(key),
            "-out",
            str(cert),
            "-subj",
            "/CN=Local Chat",
            "-addext",
            f"subjectAltName={san}",
        ],
        check=True,
        cwd=CERT_DIR,
    )
    return cert, key


class Handler(SimpleHTTPRequestHandler):
    lan_host = ""
    https_port = 0

    def do_GET(self):
        if urlparse(self.path).path == "/lan.json":
            body = json.dumps({
                "host": Handler.lan_host or lan_hostname(),
                "httpsPort": Handler.https_port,
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))


def serve_https(port: int, cert: Path, key: Path) -> ThreadingHTTPServer:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=str(cert), keyfile=str(key))
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    https_port = int(os.environ.get("HTTPS_PORT") or (port + 1))
    os.chdir(ROOT)
    host = lan_hostname()
    Handler.lan_host = host
    Handler.https_port = https_port
    cert, key = ensure_certs(host)
    serve_https(https_port, cert, key)
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Local Chat  http://localhost:{port}/", flush=True)
    if host:
        print(f"QR / LAN    https://{host}:{https_port}/", flush=True)
        print("Phones need HTTPS for WebRTC. Accept the certificate warning once,", flush=True)
        print(f"or trust {cert}.", flush=True)
    else:
        print(f"HTTPS       https://localhost:{https_port}/", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print()


if __name__ == "__main__":
    main()
