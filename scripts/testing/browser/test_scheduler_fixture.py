"""Contract checks for the loopback Scheduler fixture, not real API acceptance."""
from __future__ import annotations

import json
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from scheduler_fixture import (
    ASSIGNMENT_ID, CREATE_PATH, LIST_PATH, REVISION_2, SCHEDULE_ID, SchedulerFixtureApi,
)


class SchedulerFixtureTests(unittest.TestCase):
    def setUp(self):
        self.fixture = SchedulerFixtureApi("http://127.0.0.1:3100", port=0)
        self.fixture.start()

    def tearDown(self):
        self.fixture.close()

    def request(self, path, body=None, *, auth=True, csrf=True):
        headers = {"Origin": self.fixture.origin}
        if auth:
            headers["Cookie"] = f"atlas_admin_session={self.fixture.token}"
        if csrf:
            headers["X-CSRF-Token"] = self.fixture.csrf
        data = None if body is None else json.dumps(body).encode()
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = Request(self.fixture.url + path, data=data, headers=headers)
        try:
            response = urlopen(request, timeout=3)
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def test_fixture_cookie_and_csrf_are_required(self):
        self.assertEqual(self.request(LIST_PATH + f"?contentSiteId={ASSIGNMENT_ID}", auth=False)[0], 401)
        before = self.fixture.snapshot()
        self.assertEqual(self.request(f"{LIST_PATH}/{SCHEDULE_ID}/cancel", {"version": 7}, csrf=False)[0], 403)
        self.assertEqual(self.fixture.snapshot(), before)

    def test_cancel_recreate_keeps_old_targetless_history(self):
        path = f"{LIST_PATH}/{SCHEDULE_ID}/cancel"
        before = self.fixture.snapshot()["rows"]
        self.assertEqual(self.request(path, {"version": 8})[0], 409)
        self.assertEqual(self.fixture.snapshot()["rows"], before)
        self.assertEqual(self.request(path, {"version": 7})[0], 200)
        old = self.fixture.snapshot()["rows"][0]
        self.assertEqual(old["target"], before[0]["target"])
        self.assertEqual(self.request(path, {"version": 7})[0], 200)
        self.assertEqual(self.fixture.snapshot()["rows"][0], old)
        body = {"action": "publish", "scheduledLocalAt": "2099-01-01T00:00", "timezone": "UTC"}
        status, response = self.request(CREATE_PATH, body)
        self.assertEqual(status, 201)
        self.assertEqual(response["data"]["target"]["revisionId"], REVISION_2)
        self.assertNotEqual(response["data"]["id"], SCHEDULE_ID)
        self.assertEqual(self.fixture.snapshot()["rows"][0], old)
        self.assertEqual(self.request(CREATE_PATH, body)[0], 409)

    def test_failed_unresolved_fixture_cannot_be_retried_or_cancelled(self):
        self.fixture.configure("legacy-failed")
        old = self.fixture.snapshot()["rows"]
        for action in ["cancel", "retry"]:
            self.assertEqual(self.request(f"{LIST_PATH}/{SCHEDULE_ID}/{action}", {"version": 7})[0], 409)
            self.assertEqual(self.fixture.snapshot()["rows"], old)
        self.assertEqual(self.request(CREATE_PATH, {
            "action": "publish", "scheduledLocalAt": "2099-01-01T00:00", "timezone": "UTC",
        })[0], 201)
        self.assertEqual(self.fixture.snapshot()["rows"][0], old[0])

    def test_mock_pointer_advancement_does_not_change_stored_targets(self):
        for mode in ["publish", "withdraw"]:
            self.fixture.configure(mode)
            old = self.fixture.snapshot()["rows"]
            self.fixture.advance_live_pointers()
            self.assertEqual(self.fixture.snapshot()["rows"], old)
        with self.assertRaises(ValueError):
            SchedulerFixtureApi("https://not-loopback.invalid", port=0)


if __name__ == "__main__":
    unittest.main()
