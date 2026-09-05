"""Real Next.js production UI regression gate with a loopback fake API.

Run from the repository root after pnpm install --frozen-lockfile.
No extra app route or production authentication bypass is introduced.
Preparation errors are failures, never skips or synthetic green results.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from fixture_api import CONTENT_ID, OTHER_ID, FixtureApi

ROOT = Path(__file__).resolve().parents[3]
APP_URL = "http://127.0.0.1:3100"


class EditorBrowserTests(unittest.TestCase):
    fixture: FixtureApi
    browser: object
    output: Path

    def setUp(self):
        from playwright.sync_api import expect
        self.expect = expect
        self.fixture.reset()
        self.errors = []
        self.context = self.browser.new_context(service_workers="block")
        self.context.tracing.start(screenshots=True, snapshots=True, sources=True)
        self.context.add_cookies([
            {"name": "atlas_admin_session", "value": self.fixture.token, "url": APP_URL, "httpOnly": True},
            {"name": "atlas_admin_csrf", "value": self.fixture.csrf, "url": APP_URL},
        ])
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.on("dialog", lambda dialog: dialog.accept())
        self.page.goto(f"{APP_URL}/admin/contents/{CONTENT_ID}")
        self.title = self.page.get_by_role("textbox", name="제목", exact=True)
        self.expect(self.title).to_have_value("initial")
        # Advance debounce timers explicitly rather than depending on wall-clock sleeps.
        self.page.clock.install()

    def tearDown(self):
        self.fixture.release_patch.set()
        self.context.tracing.stop(path=self.output / f"{self._testMethodName}.zip")
        self.context.close()
        self.assertTrue(self.fixture.idle.wait(5), "Previous fixture write did not terminate")
        self.assertEqual(self.errors, [], "Unhandled page error or hydration/runtime failure")

    def hold_autosave(self):
        self.fixture.hold_next = True
        self.title.fill("A")
        self.page.clock.fast_forward(1300)
        self.assertTrue(self.fixture.patch_started.wait(3), "Autosave did not reach the API")

    def test_manual_save_preserves_newer_input_and_advances_version(self):
        self.fixture.hold_next = True
        self.title.fill("A")
        self.page.get_by_role("button", name="즉시 저장", exact=True).click()
        self.assertTrue(self.fixture.patch_started.wait(3))
        self.title.fill("B")
        self.fixture.release_patch.set()
        self.expect(self.page.get_by_test_id("content-draft-version")).to_have_text("2")
        self.expect(self.title).to_have_value("B")
        self.expect(self.page.get_by_text("변경 사항 있음", exact=True)).to_be_visible()
        self.page.get_by_role("button", name="즉시 저장", exact=True).click()
        self.expect(self.page.get_by_test_id("content-draft-version")).to_have_text("3")
        calls = self.fixture.snapshot_calls()
        self.assertEqual([(x["body"]["title"], x["body"]["draftVersion"]) for x in calls], [("A", 1), ("B", 2)])

    def test_ready_waits_for_autosave_and_newer_draft(self):
        self.hold_autosave()
        self.title.fill("B")
        self.page.get_by_role("button", name="READY Revision", exact=True).click()
        self.expect(self.title).to_be_disabled()
        self.assertEqual([x["action"] for x in self.fixture.snapshot_calls()], ["draft"])
        self.fixture.release_patch.set()
        self.expect(self.title).to_be_enabled()
        self.expect(self.page.get_by_test_id("content-draft-version")).to_have_text("3")
        calls = self.fixture.snapshot_calls()
        self.assertEqual([x["action"] for x in calls], ["draft", "draft", "ready"])
        self.assertEqual(calls[-1]["body"]["draftVersion"], 3)
        self.assertEqual(calls[1]["body"]["title"], "B")

    def test_conflict_preserves_input_and_pauses_automatic_writes(self):
        self.fixture.fail_next = (409, "VERSION_CONFLICT")
        self.title.fill("A")
        self.page.get_by_role("button", name="즉시 저장", exact=True).click()
        self.expect(self.page.get_by_text("자동 저장을 중지했습니다.", exact=False)).to_be_visible()
        self.title.fill("B")
        self.page.clock.fast_forward(4000)
        self.expect(self.page.get_by_role("button", name="READY Revision", exact=True)).to_be_disabled()
        self.assertEqual(len(self.fixture.snapshot_calls()), 1)
        self.page.get_by_text("현재 입력 확인·복사", exact=True).click()
        preserved = self.page.get_by_role("textbox", name="보존된 Draft 입력").input_value()
        self.assertEqual(json.loads(preserved)["title"], "B")
        self.expect(self.title).to_have_value("B")

    def test_validation_can_be_corrected_without_discarding_input(self):
        self.fixture.fail_next = (400, "VALIDATION_FAILED")
        self.page.get_by_role("button", name="READY Revision", exact=True).click()
        self.expect(self.page.get_by_text("입력값을 수정한 뒤 다시 시도하세요.", exact=False)).to_be_visible()
        self.title.fill("corrected")
        self.page.get_by_role("button", name="READY Revision", exact=True).click()
        self.expect(self.page.locator('[aria-live="polite"]').get_by_text("READY Revision 1을 생성했습니다.", exact=True)).to_be_visible()
        self.expect(self.title).to_have_value("corrected")
        self.assertEqual([x["action"] for x in self.fixture.snapshot_calls()], ["ready", "draft", "ready"])

    def test_double_ready_click_creates_one_revision(self):
        ready = self.page.get_by_role("button", name="READY Revision", exact=True)
        ready.evaluate("button => { button.click(); button.click(); }")
        self.expect(self.page.locator('[aria-live="polite"]').get_by_text("READY Revision 1을 생성했습니다.", exact=True)).to_be_visible()
        self.assertEqual([x["action"] for x in self.fixture.snapshot_calls()], ["ready"])

    def test_next_spa_navigation_ignores_previous_editor_response(self):
        self.hold_autosave()
        self.page.get_by_role("link", name="목록으로", exact=True).click()
        self.page.locator(f'a[href="/admin/contents/{OTHER_ID}"]').click()
        self.expect(self.title).to_have_value("other")
        self.fixture.release_patch.set()
        # A read is synchronized by the same fixture lock used to commit writes.
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            with self.fixture.lock:
                completed = self.fixture.contents[CONTENT_ID]["draft"]["draftVersion"] == 2
            if completed:
                break
            time.sleep(0.01)
        self.assertTrue(completed)
        self.expect(self.title).to_have_value("other")
        self.expect(self.page.get_by_test_id("content-draft-version")).to_have_text("1")
        self.assertEqual(len(self.fixture.snapshot_calls()), 1)

    def test_archive_flushes_draft_and_disables_further_editing(self):
        self.title.fill("before archive")
        self.page.get_by_role("button", name="Archive", exact=True).click()
        self.expect(self.title).to_be_disabled()
        self.expect(self.page.locator('[aria-live="polite"]').get_by_text("콘텐츠를 Archive했습니다.", exact=True)).to_be_visible()
        calls = self.fixture.snapshot_calls()
        self.assertEqual([x["action"] for x in calls], ["draft", "archive"])
        self.assertEqual(calls[0]["body"]["title"], "before archive")


def wait_for_app(process: subprocess.Popen, timeout: int = 90) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Next.js exited before readiness; inspect next-start.log")
        try:
            with urlopen(APP_URL + "/login", timeout=1) as response:
                if response.status == 200:
                    return
        except (HTTPError, URLError, TimeoutError):
            pass
        time.sleep(0.2)
    raise TimeoutError("Next.js did not become ready")


def terminate(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    if os.name == "posix":
        os.killpg(process.pid, signal.SIGTERM)
    else:
        process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
        process.wait(timeout=5)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/r01-browser")
    parser.add_argument("--chromium-executable", default=None)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report = {"scope": "Real Next.js production UI; API/Auth/DB are loopback fixtures", "status": "not_run"}
    process = None
    fixture = None
    log = None
    try:
        pnpm = shutil.which("pnpm")
        if pnpm is None:
            raise RuntimeError("pnpm is unavailable; install the repository's pinned toolchain first")
        from playwright.sync_api import sync_playwright
        fixture = FixtureApi(APP_URL)
        fixture.start()
        environment = {**os.environ, "NEXT_PUBLIC_ATLAS_API_URL": fixture.url + "/api",
                       "ATLAS_API_INTERNAL_URL": fixture.url + "/api",
                       "NEXT_PUBLIC_ATLAS_CSRF_COOKIE_NAME": "atlas_admin_csrf", "NEXT_TELEMETRY_DISABLED": "1"}
        with (output / "next-build.log").open("w") as build_log:
            subprocess.run([pnpm, "--filter", "@atlas/admin-web", "build"], cwd=ROOT, env=environment,
                           stdout=build_log, stderr=subprocess.STDOUT, check=True, timeout=600)
        log = (output / "next-start.log").open("w")
        process = subprocess.Popen([pnpm, "--filter", "@atlas/admin-web", "exec", "next", "start",
                                    "--hostname", "127.0.0.1", "--port", "3100"],
                                   cwd=ROOT, env=environment, stdout=log, stderr=subprocess.STDOUT,
                                   start_new_session=True)
        wait_for_app(process)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=args.chromium_executable)
            try:
                EditorBrowserTests.fixture = fixture
                EditorBrowserTests.browser = browser
                EditorBrowserTests.output = output
                result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(EditorBrowserTests))
                report.update(status="passed" if result.wasSuccessful() else "failed", tests_run=result.testsRun,
                              failures=len(result.failures), errors=len(result.errors), skipped=len(result.skipped), browser=browser.version)
            finally:
                browser.close()
        return 0 if report["status"] == "passed" else 1
    except Exception as error:
        report.update(status="preparation_failed", error=str(error))
        print(json.dumps(report, ensure_ascii=False))
        return 1
    finally:
        terminate(process)
        if log is not None:
            log.close()
        if fixture is not None:
            fixture.close()
        report["source_sha256"] = {
            name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
            for name in ["apps/admin-web/src/features/content/content-editor.tsx",
                         "apps/admin-web/src/features/content/draft-save-coordinator.ts",
                         "apps/admin-web/src/features/content/draft-save-error.ts"]
        }
        (output / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    raise SystemExit(main())
