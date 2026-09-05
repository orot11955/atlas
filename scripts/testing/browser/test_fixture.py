"""Fixture contract tests; these do not exercise Next.js or production authentication."""
import concurrent.futures
import json
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from fixture_api import CONTENT_ID, PREFIX, FixtureApi


class FixtureContractTests(unittest.TestCase):
    def setUp(self):
        self.fixture = FixtureApi("http://127.0.0.1:3100", port=0)
        self.fixture.start()
        self.addCleanup(self.fixture.close)

    def request(self, path, method="GET", body=None, headers=None):
        defaults = {"Cookie": f"atlas_admin_session={self.fixture.token}",
                    "X-CSRF-Token": self.fixture.csrf, "Content-Type": "application/json"}
        defaults.update(headers or {})
        request = Request(self.fixture.url + PREFIX + path, method=method,
                          data=json.dumps(body).encode() if body is not None else None, headers=defaults)
        try:
            with urlopen(request, timeout=5) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def test_session_and_csrf_are_required(self):
        self.assertEqual(self.request("/auth/session", headers={"Cookie": ""})[0], 401)
        self.assertEqual(self.request("/auth/session")[0], 200)
        self.assertEqual(self.request(f"/contents/{CONTENT_ID}/draft", "PATCH", {}, {"X-CSRF-Token": ""})[0], 403)
        self.assertEqual(self.fixture.snapshot_calls(), [])

    def test_versions_are_monotonic_and_stale_writes_rejected(self):
        path = f"/contents/{CONTENT_ID}/draft"
        body = {"draftVersion": 1, "title": "A", "bodyMarkdown": "body", "cover": None}
        status, response = self.request(path, "PATCH", body)
        self.assertEqual(status, 200)
        self.assertEqual(response["data"]["draft"]["draftVersion"], 2)
        self.assertEqual(self.request(path, "PATCH", body)[0], 409)

    def test_injected_validation_does_not_commit(self):
        self.fixture.fail_next = (400, "VALIDATION_FAILED")
        self.assertEqual(self.request(f"/contents/{CONTENT_ID}/draft", "PATCH", {"draftVersion": 1})[0], 400)
        content = self.request(f"/contents/{CONTENT_ID}")[1]["data"]
        self.assertEqual(content["draft"]["draftVersion"], 1)
        self.assertEqual(content["draft"]["title"], "initial")

    def test_held_patch_commits_only_after_release(self):
        self.fixture.hold_next = True
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(self.request, f"/contents/{CONTENT_ID}/draft", "PATCH", {"draftVersion": 1, "title": "A"})
            try:
                self.assertTrue(self.fixture.patch_started.wait(2))
                self.assertFalse(future.done())
                self.assertEqual(self.request(f"/contents/{CONTENT_ID}")[1]["data"]["draft"]["draftVersion"], 1)
            finally:
                self.fixture.release_patch.set()
            self.assertEqual(future.result()[0], 200)

    def test_revision_requires_both_acknowledged_versions(self):
        self.assertEqual(self.request(f"/contents/{CONTENT_ID}/ready", "POST", {"contentVersion": 2, "draftVersion": 1})[0], 409)
        status, response = self.request(f"/contents/{CONTENT_ID}/ready", "POST", {"contentVersion": 1, "draftVersion": 1})
        self.assertEqual(status, 200)
        self.assertEqual(response["data"]["readyRevisionNumber"], 1)

    def test_list_envelopes_match_the_current_frontend_contract(self):
        for path in ["/sites", "/contents"]:
            status, response = self.request(path)
            self.assertEqual(status, 200)
            self.assertIsInstance(response["data"]["items"], list)
            self.assertEqual(response["data"]["pageInfo"], {})

    def test_foreign_origins_and_unknown_paths_fail_closed(self):
        self.assertEqual(self.request("/auth/session", headers={"Origin": "https://example.invalid"})[0], 403)
        self.assertEqual(self.request("/unknown")[0], 404)


if __name__ == "__main__":
    unittest.main()
