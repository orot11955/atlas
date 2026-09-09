"""Scheduler HTTP-boundary fixture for the actual production Next.js panel.

Reuses the existing loopback fixture's cookie, CSRF and CORS handling. This is
NOT evidence of real authentication, persistence, migrations or Worker execution;
those are covered separately by the authenticated legacy HTTP and database gates.
"""
from __future__ import annotations

import copy
import threading
from urllib.parse import parse_qs, urlsplit

from fixture_api import CONTENT_ID, PREFIX, STAMP, FixtureApi

WORKSPACE_ID = "01991892-1000-7000-8000-000000000003"
SITE_ID = "01991892-1000-7000-8000-000000000004"
ASSIGNMENT_ID = "01991892-1000-7000-8000-000000000005"
REVISION_1 = "01991892-1000-7000-8000-000000000011"
REVISION_2 = "01991892-1000-7000-8000-000000000012"
REVISION_3 = "01991892-1000-7000-8000-000000000013"
PUBLICATION_1 = "01991892-1000-7000-8000-000000000021"
PUBLICATION_2 = "01991892-1000-7000-8000-000000000022"
SCHEDULE_ID = "01991892-1000-7000-8000-000000000031"
CREATE_PATH = f"{PREFIX}/contents/{CONTENT_ID}/sites/{ASSIGNMENT_ID}/schedules"
LIST_PATH = PREFIX + "/publication-schedules"


def revision_target(identifier=REVISION_1, number=1):
    return {"kind": "revision", "revisionId": identifier, "revisionNumber": number}


def publication_target(identifier=PUBLICATION_1):
    return {"kind": "publication", "publicationId": identifier}


def eligibility(row):
    row["operations"] = {
        "canCancel": row["status"] == "pending",
        "canRetry": row["status"] == "failed" and row["target"]["kind"] != "unresolved",
    }
    return row


def schedule_row(mode="legacy-pending", identifier=SCHEDULE_ID):
    target = {"kind": "unresolved", "reason": "missing-target"}
    if mode in {"publish", "resolved-failed", "processing"}:
        target = revision_target()
    elif mode == "withdraw":
        target = publication_target()
    status = "failed" if mode.endswith("failed") else "processing" if mode == "processing" else "pending"
    return eligibility({
        "id": identifier, "workspaceId": WORKSPACE_ID, "siteId": SITE_ID,
        "siteKey": "scheduler-fixture", "siteName": "Scheduler fixture",
        "contentId": CONTENT_ID, "contentTitle": "initial", "contentSiteId": ASSIGNMENT_ID,
        "action": "withdraw" if mode == "withdraw" else "publish",
        "revisionId": target.get("revisionId"), "revisionNumber": target.get("revisionNumber"),
        "targetPublicationId": target.get("publicationId"), "target": target,
        "scheduledFor": "2099-01-01T00:00:00.000Z", "timezone": "UTC",
        "scheduledLocalAt": "2099-01-01T00:00:00", "status": status,
        "attemptCount": 3 if status == "failed" else 1 if status == "processing" else 0,
        "nextAttemptAt": "2099-01-01T00:00:00.000Z", "version": 7,
        "failureCode": "execution-failed" if status == "failed" else None,
        "lastError": "Publication schedule execution failed." if status == "failed" else None,
        "completedAt": STAMP if status == "failed" else None, "cancelledAt": None,
        "requestedByAdminAccountId": "fixture-admin", "createdAt": STAMP, "updatedAt": STAMP,
    })


class SchedulerFixtureApi(FixtureApi):
    def reset(self):
        super().reset()
        with self.lock:
            self.contents[CONTENT_ID].update(status="ready", currentRevisionNumber=2, readyRevisionNumber=2)
            self.current_revision = REVISION_2
            self.assignment = {
                "id": ASSIGNMENT_ID, "contentId": CONTENT_ID,
                "site": {"id": SITE_ID, "key": "scheduler-fixture", "name": "Scheduler fixture", "status": "active"},
                "slug": "scheduler-fixture", "titleOverride": None, "summaryOverride": None,
                "seo": {}, "visibility": "public", "version": 1,
                "activePublication": {
                    "id": PUBLICATION_1, "revisionId": REVISION_1, "revisionNumber": 1,
                    "status": "active", "etag": "fixture-etag-1", "publishedAt": STAMP,
                },
                "createdAt": STAMP, "updatedAt": STAMP,
            }
            self.schedules = [schedule_row()]
            self.scheduler_calls = []
            self.list_calls = 0
            self.fail_lists = 0
            self.fail_schedule = None
            self.hold_schedule = False
            self.hold_list = False
            self.schedule_started = threading.Event()
            self.release_schedule = threading.Event()
            self.list_started = threading.Event()
            self.release_list = threading.Event()
            self.sequence = 100

    def configure(self, mode):
        with self.lock:
            self.schedules = [] if mode == "empty" else [schedule_row(mode)]

    def advance_live_pointers(self):
        with self.lock:
            self.contents[CONTENT_ID].update(currentRevisionNumber=3, readyRevisionNumber=3)
            self.current_revision = REVISION_3
            self.assignment["activePublication"].update(
                id=PUBLICATION_2, revisionId=REVISION_3, revisionNumber=3, etag="fixture-etag-2")

    def snapshot(self):
        with self.lock:
            return copy.deepcopy({"rows": self.schedules, "calls": self.scheduler_calls,
                                  "listCalls": self.list_calls, "assignment": self.assignment,
                                  "content": self.contents[CONTENT_ID]})

    def close(self):
        self.release_schedule.set()
        self.release_list.set()
        super().close()

    def _handler(self):
        base = super()._handler()
        fixture = self

        class Handler(base):
            def do_GET(self):
                parsed = urlsplit(self.path)
                if parsed.path not in {LIST_PATH, f"{PREFIX}/contents/{CONTENT_ID}/sites"}:
                    return super().do_GET()
                if not self.authorized():
                    return
                if parsed.path.endswith("/sites"):
                    with fixture.lock:
                        self.reply(200, [copy.deepcopy(fixture.assignment)])
                    return
                query = parse_qs(parsed.query)
                if query.get("contentSiteId") != [ASSIGNMENT_ID] or query.get("contentId", [CONTENT_ID]) != [CONTENT_ID]:
                    self.reply(200, {"items": []})
                    return
                self.tracked(self.read_schedules)

            def tracked(self, work):
                with fixture.lock:
                    fixture.inflight += 1
                    fixture.idle.clear()
                try:
                    work()
                finally:
                    with fixture.lock:
                        fixture.inflight -= 1
                        if fixture.inflight == 0:
                            fixture.idle.set()

            def read_schedules(self):
                with fixture.lock:
                    fixture.list_calls += 1
                    held = fixture.hold_list
                    fixture.hold_list = False
                    fail = fixture.fail_lists > 0
                    if fail:
                        fixture.fail_lists -= 1
                fixture.list_started.set()
                if held and not fixture.release_list.wait(15):
                    self.reject(503, "FIXTURE_DEADLINE")
                    return
                if fail:
                    self.reject(503, "FIXTURE_LIST_UNAVAILABLE")
                    return
                with fixture.lock:
                    self.reply(200, {"items": copy.deepcopy(fixture.schedules)})

            def do_POST(self):
                path = urlsplit(self.path).path
                if path != CREATE_PATH and not path.startswith(LIST_PATH + "/"):
                    return super().do_POST()
                if not self.authorized(mutation=True):
                    return
                data = self.body()
                if data is not None:
                    self.tracked(lambda: self.write_schedule(path, data))

            def write_schedule(self, path, data):
                action = "create" if path == CREATE_PATH else path.rsplit("/", 1)[-1]
                with fixture.lock:
                    fixture.scheduler_calls.append({"action": action, "path": path, "body": copy.deepcopy(data)})
                    held = fixture.hold_schedule
                    fixture.hold_schedule = False
                    failure = fixture.fail_schedule
                    fixture.fail_schedule = None
                fixture.schedule_started.set()
                if held and not fixture.release_schedule.wait(15):
                    self.reject(503, "FIXTURE_DEADLINE")
                    return
                if failure:
                    self.reject(*failure)
                    return
                with fixture.lock:
                    if action == "create":
                        if any(row["status"] in {"pending", "processing"} for row in fixture.schedules):
                            self.reject(409, "VERSION_CONFLICT")
                            return
                        if data.get("action") not in {"publish", "withdraw"} or not data.get("timezone") or not data.get("scheduledLocalAt"):
                            self.reject(400, "VALIDATION_FAILED")
                            return
                        fixture.sequence += 1
                        row = schedule_row(data["action"], f"01991892-1000-7000-8000-{fixture.sequence:012d}")
                        target = revision_target(fixture.current_revision, fixture.contents[CONTENT_ID]["readyRevisionNumber"]) if data["action"] == "publish" else publication_target(fixture.assignment["activePublication"]["id"])
                        row.update(target=target, revisionId=target.get("revisionId"),
                                   revisionNumber=target.get("revisionNumber"), targetPublicationId=target.get("publicationId"),
                                   version=1, scheduledLocalAt=data["scheduledLocalAt"], timezone=data["timezone"])
                        fixture.schedules.append(row)
                        self.reply(201, copy.deepcopy(row))
                        return
                    identifier = path.removeprefix(LIST_PATH + "/").split("/", 1)[0]
                    row = next((item for item in fixture.schedules if item["id"] == identifier), None)
                    if row is None or action not in {"cancel", "retry"}:
                        self.reject(404, "NOT_FOUND")
                        return
                    if action == "cancel" and row["status"] == "cancelled":
                        self.reply(200, copy.deepcopy(row))
                        return
                    if not row["operations"]["canCancel" if action == "cancel" else "canRetry"]:
                        self.reject(409, "INVALID_STATE_TRANSITION")
                        return
                    if data.get("version") != row["version"]:
                        self.reject(409, "VERSION_CONFLICT")
                        return
                    row["version"] += 1
                    row["status"] = "cancelled" if action == "cancel" else "pending"
                    if action == "cancel":
                        row["cancelledAt"] = STAMP
                    eligibility(row)
                    self.reply(200, copy.deepcopy(row))

        return Handler
