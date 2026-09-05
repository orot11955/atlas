"""Loopback-only fake API for the real Next.js ContentEditor browser tests.

No production routes, auth bypass flag, or database are added to Atlas. This
server is started only by the test process and requires its ephemeral cookie.
It is a deterministic HTTP boundary, not proof of real API/Auth/DB correctness.
"""
from __future__ import annotations

import copy
import json
import secrets
import threading
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

CONTENT_ID = "01991892-1000-7000-8000-000000000001"
OTHER_ID = "01991892-1000-7000-8000-000000000002"
PREFIX = "/api/admin/v1"
STAMP = "2026-09-05T00:00:00.000Z"


def make_content(content_id: str, title: str = "initial") -> dict:
    return {
        "id": content_id, "workspaceId": "01991892-1000-7000-8000-000000000003",
        "type": "post", "status": "draft", "version": 1,
        "currentRevisionNumber": None, "readyRevisionNumber": None,
        "archivedAt": None, "createdByAdminAccountId": "fixture-admin",
        "createdAt": STAMP, "updatedAt": STAMP,
        "draft": {"title": title, "summary": None, "bodyMarkdown": "body",
                  "cover": None, "draftVersion": 1, "updatedAt": STAMP,
                  "updatedByAdminAccountId": "fixture-admin"},
    }


class FixtureApi:
    def __init__(self, origin: str, port: int = 4101) -> None:
        if urlsplit(origin).hostname not in {"127.0.0.1", "localhost"}:
            raise ValueError("Fixture browser origin must be loopback.")
        self.origin = origin
        self.token = secrets.token_urlsafe(24)
        self.csrf = secrets.token_urlsafe(24)
        self.lock = threading.Lock()
        self.idle = threading.Event()
        self.idle.set()
        self.inflight = 0
        self.patch_started = threading.Event()
        self.release_patch = threading.Event()
        self.server = ThreadingHTTPServer(("127.0.0.1", port), self._handler())
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.reset()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}"

    def reset(self) -> None:
        if not self.idle.wait(timeout=5):
            raise RuntimeError("The preceding fixture write has not finished")
        with self.lock:
            self.contents = {CONTENT_ID: make_content(CONTENT_ID), OTHER_ID: make_content(OTHER_ID, "other")}
            self.calls: list[dict] = []
            self.fail_next: tuple[int, str] | None = None
            self.hold_next = False
            self.patch_started.clear()
            self.release_patch.clear()

    def start(self) -> None:
        self.thread.start()

    def close(self) -> None:
        self.release_patch.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def snapshot_calls(self) -> list[dict]:
        with self.lock:
            return copy.deepcopy(self.calls)

    def _handler(self):
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args) -> None:
                pass

            def reply(self, status: int, data: object, *, problem: bool = False) -> None:
                body = json.dumps(data if problem else {"data": data}).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/problem+json" if problem else "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Access-Control-Allow-Origin", fixture.origin)
                self.send_header("Access-Control-Allow-Credentials", "true")
                self.send_header("Vary", "Origin")
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    # A route change may abandon a response after the write committed.
                    pass

            def reject(self, status: int, code: str) -> None:
                self.reply(status, {"type": "about:blank", "status": status,
                                    "code": code, "title": "Fixture rejection", "detail": code}, problem=True)

            def authorized(self, mutation: bool = False) -> bool:
                cookies = SimpleCookie(self.headers.get("Cookie", ""))
                cookie = cookies.get("atlas_admin_session")
                if not cookie or cookie.value != fixture.token:
                    self.reject(401, "AUTH_REQUIRED")
                    return False
                origin = self.headers.get("Origin")
                if origin and origin != fixture.origin:
                    self.reject(403, "FORBIDDEN")
                    return False
                if mutation and self.headers.get("X-CSRF-Token") != fixture.csrf:
                    self.reject(403, "FORBIDDEN")
                    return False
                return True

            def do_OPTIONS(self) -> None:
                if self.headers.get("Origin") != fixture.origin:
                    self.reject(403, "FORBIDDEN")
                    return
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", fixture.origin)
                self.send_header("Access-Control-Allow-Credentials", "true")
                self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "content-type,x-csrf-token")
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_GET(self) -> None:
                if not self.authorized():
                    return
                path = urlsplit(self.path).path
                if path == PREFIX + "/auth/session":
                    self.reply(200, {"id": "fixture-session", "role": "owner", "userAgentSummary": "UI fixture",
                                     "createdAt": STAMP, "lastSeenAt": STAMP,
                                     "idleExpiresAt": "2099-01-01T00:00:00Z", "absoluteExpiresAt": "2099-01-01T00:00:00Z"})
                    return
                if path == PREFIX + "/sites":
                    self.reply(200, {"items": [], "pageInfo": {}})
                    return
                if path == PREFIX + "/contents":
                    with fixture.lock:
                        self.reply(200, {"items": list(fixture.contents.values()), "pageInfo": {}})
                    return
                with fixture.lock:
                    for content_id, content in fixture.contents.items():
                        base = PREFIX + "/contents/" + content_id
                        if path == base:
                            self.reply(200, content)
                            return
                        if path in {base + "/revisions", base + "/sites"}:
                            self.reply(200, [])
                            return
                self.reject(404, "NOT_FOUND")

            def body(self) -> dict | None:
                try:
                    size = int(self.headers.get("Content-Length", "0"))
                    if not 0 < size <= 1_000_000:
                        raise ValueError("invalid body size")
                    result = json.loads(self.rfile.read(size))
                    if not isinstance(result, dict):
                        raise ValueError("JSON object required")
                    return result
                except (ValueError, json.JSONDecodeError):
                    self.reject(400, "VALIDATION_FAILED")
                    return None

            def _mutate(self) -> None:
                if not self.authorized(mutation=True):
                    return
                data = self.body()
                if data is None:
                    return
                parts = urlsplit(self.path).path.removeprefix(PREFIX + "/contents/").split("/")
                if len(parts) != 2 or parts[1] not in {"draft", "ready", "checkpoints", "archive"}:
                    self.reject(404, "NOT_FOUND")
                    return
                content_id, action = parts
                if self.command != ("PATCH" if action == "draft" else "POST"):
                    self.reject(405, "METHOD_NOT_ALLOWED")
                    return
                with fixture.lock:
                    if content_id not in fixture.contents:
                        self.reject(404, "NOT_FOUND")
                        return
                    fixture.calls.append({"contentId": content_id, "action": action, "body": copy.deepcopy(data)})
                    hold = fixture.hold_next and action == "draft"
                    if hold:
                        fixture.hold_next = False
                    failure = fixture.fail_next
                    fixture.fail_next = None
                if action == "draft":
                    fixture.patch_started.set()
                if hold and not fixture.release_patch.wait(timeout=15):
                    self.reject(503, "FIXTURE_DEADLINE")
                    return
                if failure:
                    self.reject(*failure)
                    return
                with fixture.lock:
                    content = fixture.contents[content_id]
                    if action != "archive" and data.get("draftVersion") != content["draft"]["draftVersion"]:
                        self.reject(409, "VERSION_CONFLICT")
                        return
                    if action != "draft" and data.get("contentVersion") != content["version"]:
                        self.reject(409, "VERSION_CONFLICT")
                        return
                    if action == "draft":
                        content["draft"].update({key: data.get(key) for key in ("title", "summary", "bodyMarkdown", "cover")})
                        content["draft"]["draftVersion"] += 1
                    elif action in {"ready", "checkpoints"}:
                        content["version"] += 1
                        content["currentRevisionNumber"] = (content["currentRevisionNumber"] or 0) + 1
                        if action == "ready":
                            content["readyRevisionNumber"] = content["currentRevisionNumber"]
                    else:
                        content["status"] = "archived"
                        content["version"] += 1
                    self.reply(200, content)

            def mutate(self) -> None:
                with fixture.lock:
                    fixture.inflight += 1
                    fixture.idle.clear()
                try:
                    self._mutate()
                finally:
                    with fixture.lock:
                        fixture.inflight -= 1
                        if fixture.inflight == 0:
                            fixture.idle.set()

            do_PATCH = mutate
            do_POST = mutate

        return Handler
