"""Local-only CAPTCHA OCR bridge for the Tampermonkey direct-login flow.

The recognition strategy mirrors shopgpt-daily-benefit: try ddddocr's standard
model, then beta, keep digits only, and accept exactly four characters. The
server binds to loopback only and never logs image bytes or recognized codes.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

HOST = "127.0.0.1"
PORT = int(os.environ.get("CAPTCHA_OCR_PORT", "18766"))
MAX_IMAGE_BYTES = 256 * 1024
_ocr_standard: Any = None
_ocr_beta: Any = None


def _ocr(beta: bool = False) -> Any:
    import ddddocr

    global _ocr_standard, _ocr_beta
    if beta:
        if _ocr_beta is None:
            _ocr_beta = ddddocr.DdddOcr(show_ad=False, beta=True)
        return _ocr_beta
    if _ocr_standard is None:
        _ocr_standard = ddddocr.DdddOcr(show_ad=False)
    return _ocr_standard


def captcha_answer(raw: str) -> str:
    """Normalize a four-digit CAPTCHA or calculate a simple arithmetic CAPTCHA."""
    text = str(raw or "").strip().replace("×", "*").replace("x", "*").replace("X", "*").replace("÷", "/")
    expression = re.fullmatch(r"(\d{1,3})\s*([+\-*/])\s*(\d{1,3})\s*=?", text)
    if expression:
        left, operator, right = int(expression.group(1)), expression.group(2), int(expression.group(3))
        if operator == "+": value = left + right
        elif operator == "-": value = left - right
        elif operator == "*": value = left * right
        elif right != 0: value = left // right
        else: return ""
        return str(value) if 0 <= value <= 9999 else ""
    digits = re.sub(r"\D", "", text)
    return digits if len(digits) == 4 and not re.search(r"[+\-*/]", text) else ""


def recognize(image: bytes) -> str:
    if not image or len(image) > MAX_IMAGE_BYTES:
        return ""
    for beta in (False, True):
        try:
            value = captcha_answer(str(_ocr(beta).classification(image)))
        except Exception:
            continue
        # Arithmetic challenges often produce one to three digits; portal
        # challenges remain four digits. Keep both forms accepted.
        if 1 <= len(value) <= 4:
            return value
    return ""


class Handler(BaseHTTPRequestHandler):
    server_version = "JXCaptchaOCR/1.0"

    def _headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "http://10.10.94.90:22112")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._headers()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self.send_error(404)
            return
        body = b'{"ok":true,"service":"captcha-ocr"}'
        self.send_response(200)
        self._headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/ocr":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_IMAGE_BYTES * 2:
                raise ValueError("invalid payload size")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            encoded = str(payload.get("imageBase64", ""))
            if "," in encoded:
                encoded = encoded.split(",", 1)[1]
            image = base64.b64decode(encoded, validate=True)
            code = recognize(image)
            body = json.dumps({"ok": bool(code), "code": code}, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self._headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ValueError, TypeError, json.JSONDecodeError, binascii.Error):
            body = b'{"ok":false,"code":""}'
            self.send_response(400)
            self._headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        # Do not log requests, image metadata, or recognized CAPTCHA values.
        return


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"captcha OCR listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
