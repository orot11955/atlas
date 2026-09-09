"""Focused Scheduler DOM, request-race, keyboard and responsive-layout acceptance.

Runs the actual production Next.js panel in Chromium against the existing
loopback fixture foundation. API, authentication and persistence are mocked here;
see the separate scheduler-legacy-http gate for actual authenticated HTTP + DB.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest

from editor_browser import APP_URL, ROOT, terminate, wait_for_app
from fixture_api import CONTENT_ID
from scheduler_fixture import (
    PUBLICATION_1, PUBLICATION_2, REVISION_1, REVISION_2, REVISION_3,
    SCHEDULE_ID, SchedulerFixtureApi, eligibility,
)


class SchedulerBrowserTests(unittest.TestCase):
    def setUp(self):
        from playwright.sync_api import expect
        self.expect = expect
        self.fixture.reset()
        self.errors = []
        self.context = self.browser.new_context(service_workers="block", locale="ko-KR", timezone_id="UTC")
        self.context.tracing.start(screenshots=True, snapshots=True, sources=True)
        self.context.add_cookies([
            {"name": "atlas_admin_session", "value": self.fixture.token, "url": APP_URL, "httpOnly": True},
            {"name": "atlas_admin_csrf", "value": self.fixture.csrf, "url": APP_URL},
        ])
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.on("dialog", lambda dialog: dialog.accept())
        self.region = self.page.get_by_role("region", name="발행 예약", exact=True)

    def tearDown(self):
        self.fixture.release_schedule.set()
        self.fixture.release_list.set()
        self.fixture.release_patch.set()
        try:
            if self.region.count() == 1:
                self.evidence(self._testMethodName)
        finally:
            self.context.tracing.stop(path=self.output / f"{self._testMethodName}.zip")
            self.context.close()
        self.assertTrue(self.fixture.idle.wait(5), "Fixture request leaked across tests")
        self.assertEqual(self.errors, [], "Unhandled page, hydration or runtime failure")

    def visit(self):
        self.page.goto(f"{APP_URL}/admin/contents/{CONTENT_ID}")
        self.expect(self.page.get_by_role("textbox", name="제목", exact=True)).to_have_value("initial")
        self.expect(self.region).to_be_visible()

    def open(self, mode="legacy-pending"):
        self.fixture.configure(mode)
        self.visit()
        self.region.get_by_role("button", name="발행 예약", exact=True).click()
        self.settled()

    def settled(self):
        self.expect(self.region.get_by_role("button", name="새로고침", exact=True)).to_be_enabled()

    def row(self, identifier=SCHEDULE_ID):
        return self.region.locator(f'[data-schedule-id="{identifier}"]')

    def status(self):
        return self.region.get_by_role("status")

    def create_button(self):
        return self.region.get_by_role("button", name="예약 생성", exact=True)

    def evidence(self, name):
        self.region.screenshot(path=self.output / f"{name}.png", animations="disabled")
        record = {
            "viewport": self.page.viewport_size,
            "dom": self.region.evaluate("node => node.outerHTML"),
            "accessibility": self.region.aria_snapshot(),
            "fixture": self.fixture.snapshot(),
        }
        (self.output / f"{name}.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")

    def test_publish_target_remains_pinned_after_ready_pointer_changes(self):
        self.open("publish")
        self.expect(self.row().get_by_text(REVISION_1, exact=True)).to_be_visible()
        self.expect(self.row()).to_contain_text("고정 대상: READY Revision #1")
        self.expect(self.row()).to_contain_text("이후 READY Revision이 바뀌어도")
        self.expect(self.create_button()).to_be_disabled()
        before = self.fixture.snapshot()["rows"]
        self.fixture.advance_live_pointers()
        self.visit()
        self.region.get_by_role("button", name="발행 예약", exact=True).click()
        self.settled()
        self.expect(self.page.get_by_text("READY 3", exact=True)).to_be_visible()
        self.expect(self.row().get_by_text(REVISION_1, exact=True)).to_be_visible()
        self.expect(self.row().get_by_text(REVISION_3, exact=True)).to_have_count(0)
        self.assertEqual(self.fixture.snapshot()["rows"], before)

    def test_withdraw_target_remains_pinned_after_active_publication_changes(self):
        self.open("withdraw")
        self.expect(self.row().get_by_text(PUBLICATION_1, exact=True)).to_be_visible()
        self.expect(self.row()).to_contain_text("대상이 이미 교체되거나 철회되었으면")
        before = self.fixture.snapshot()["rows"]
        self.fixture.advance_live_pointers()
        self.visit()
        self.region.get_by_role("button", name="발행 예약", exact=True).click()
        self.settled()
        self.assertEqual(self.fixture.snapshot()["assignment"]["activePublication"]["id"], PUBLICATION_2)
        self.expect(self.page.get_by_text("READY 3", exact=True)).to_be_visible()
        self.expect(self.row().get_by_text(PUBLICATION_1, exact=True)).to_be_visible()
        self.expect(self.row().get_by_text(PUBLICATION_2, exact=True)).to_have_count(0)
        self.assertEqual(self.fixture.snapshot()["rows"], before)

    def test_legacy_pending_cancel_recreate_uses_confirmed_target_and_preserves_history(self):
        self.open()
        self.expect(self.row()).to_contain_text("이 예약을 취소한 뒤")
        self.expect(self.create_button()).to_be_disabled()
        self.fixture.hold_schedule = True
        self.row().get_by_role("button", name="취소", exact=True).evaluate("button => { button.click(); button.click(); }")
        self.assertTrue(self.fixture.schedule_started.wait(3))
        self.expect(self.row().get_by_role("button", name="취소", exact=True)).to_be_disabled()
        self.expect(self.create_button()).to_be_disabled()
        self.fixture.release_schedule.set()
        self.settled()
        self.expect(self.row().locator('[data-status="cancelled"]')).to_be_visible()
        self.expect(self.status()).to_contain_text("기존 예약 이력은 보존됩니다.")
        old = self.fixture.snapshot()["rows"][0]
        self.assertEqual([item["action"] for item in self.fixture.snapshot()["calls"]], ["cancel"])
        self.assertEqual(old["target"], {"kind": "unresolved", "reason": "missing-target"})
        self.region.get_by_label("Action", exact=True).select_option("publish")
        # The server's READY changes after the form was displayed. Use its response, not editor state.
        self.fixture.advance_live_pointers()
        self.create_button().click()
        self.settled()
        self.expect(self.status()).to_contain_text(f"READY Revision #3 · {REVISION_3}")
        snapshot = self.fixture.snapshot()
        self.assertEqual(snapshot["rows"][0], old)
        new = snapshot["rows"][1]
        self.assertNotEqual(new["id"], SCHEDULE_ID)
        self.expect(self.row(new["id"]).get_by_text(REVISION_3, exact=True)).to_be_visible()
        self.expect(self.region.locator("[data-schedule-id]")).to_have_count(2)
        self.assertEqual([item["action"] for item in snapshot["calls"]], ["cancel", "create"])

    def test_legacy_failed_has_no_cancel_or_retry_and_allows_separate_new_schedule(self):
        self.open("legacy-failed")
        self.expect(self.row()).to_contain_text("대상 없는 실패 예약은 재실행할 수 없습니다.")
        self.expect(self.row()).to_contain_text("실행 시도 3회")
        self.expect(self.row().get_by_role("button")).to_have_count(0)
        self.expect(self.create_button()).to_be_enabled()
        old = self.fixture.snapshot()["rows"][0]
        self.region.get_by_label("Action", exact=True).select_option("publish")
        self.create_button().click()
        self.settled()
        self.assertEqual(self.fixture.snapshot()["rows"][0], old)
        self.expect(self.status()).to_contain_text(REVISION_2)
        self.expect(self.region.locator("[data-schedule-id]")).to_have_count(2)

    def test_same_turn_duplicate_creation_sends_one_request(self):
        self.open("empty")
        self.region.get_by_label("Action", exact=True).select_option("publish")
        self.fixture.hold_schedule = True
        self.create_button().evaluate("button => { button.click(); button.click(); }")
        self.assertTrue(self.fixture.schedule_started.wait(3))
        self.expect(self.region.get_by_role("button", name="예약 중…", exact=True)).to_be_disabled()
        self.expect(self.region.get_by_role("button", name="새로고침", exact=True)).to_be_disabled()
        self.expect(self.region.get_by_label("Action", exact=True)).to_be_disabled()
        self.fixture.release_schedule.set()
        self.settled()
        self.expect(self.region.locator("[data-schedule-id]")).to_have_count(1)
        self.assertEqual([item["action"] for item in self.fixture.snapshot()["calls"]], ["create"])

    def test_resolved_retry_keeps_target_and_blocks_duplicate_requests(self):
        self.open("resolved-failed")
        self.fixture.hold_schedule = True
        retry = self.row().get_by_role("button", name="고정 대상 재실행", exact=True)
        retry.evaluate("button => { button.click(); button.click(); }")
        self.assertTrue(self.fixture.schedule_started.wait(3))
        self.expect(retry).to_be_disabled()
        self.expect(self.create_button()).to_be_disabled()
        self.fixture.release_schedule.set()
        self.settled()
        self.expect(self.row().locator('[data-status="pending"]')).to_be_visible()
        self.expect(self.row().get_by_text(REVISION_1, exact=True)).to_be_visible()
        self.assertEqual([item["action"] for item in self.fixture.snapshot()["calls"]], ["retry"])

    def test_processing_reservation_blocks_creation_and_lifecycle_buttons(self):
        self.open("processing")
        self.expect(self.create_button()).to_be_disabled()
        self.expect(self.row().get_by_role("button")).to_have_count(0)
        self.expect(self.region).to_contain_text("진행 중인 예약이 있습니다.")
        self.assertEqual(self.fixture.snapshot()["calls"], [])

    def test_initial_pending_read_blocks_creation(self):
        self.fixture.configure("empty")
        self.fixture.hold_list = True
        self.visit()
        self.region.get_by_role("button", name="발행 예약", exact=True).click()
        self.assertTrue(self.fixture.list_started.wait(3))
        self.expect(self.create_button()).to_be_disabled()
        self.expect(self.region).to_contain_text("예약 목록을 확인하기 전에는 변경할 수 없습니다.")
        self.fixture.release_list.set()
        self.settled()
        self.expect(self.create_button()).to_be_enabled()
        self.assertEqual(self.fixture.snapshot()["calls"], [])

    def test_failed_initial_read_fails_closed_until_explicit_reload(self):
        self.fixture.fail_lists = 1
        self.open("empty")
        self.expect(self.status()).to_contain_text("새로고침으로 다시 시도하세요.")
        self.expect(self.create_button()).to_be_disabled()
        self.region.get_by_role("button", name="새로고침", exact=True).click()
        self.settled()
        self.expect(self.create_button()).to_be_enabled()
        self.assertEqual(self.fixture.snapshot()["calls"], [])

    def test_conflict_refreshes_rows_without_repeating_the_rejected_action(self):
        self.open()
        with self.fixture.lock:
            row = self.fixture.schedules[0]
            row.update(status="processing", version=row["version"] + 1)
            eligibility(row)
        reads = self.fixture.snapshot()["listCalls"]
        self.row().get_by_role("button", name="취소", exact=True).click()
        self.settled()
        self.expect(self.status()).to_contain_text("예약 상태가 변경되었습니다.")
        self.expect(self.row().locator('[data-status="processing"]')).to_be_visible()
        self.expect(self.row().get_by_role("button")).to_have_count(0)
        self.expect(self.create_button()).to_be_disabled()
        snapshot = self.fixture.snapshot()
        self.assertEqual(snapshot["listCalls"], reads + 1)
        self.assertEqual([item["action"] for item in snapshot["calls"]], ["cancel"])

    def test_success_then_failed_refresh_preserves_receipt_and_blocks_further_writes(self):
        self.open("empty")
        self.fixture.fail_lists = 1
        self.create_button().click()
        self.settled()
        self.expect(self.status()).to_contain_text("예약을 생성했습니다.")
        self.expect(self.status()).to_contain_text("목록을 확인하지 못했습니다.")
        self.expect(self.create_button()).to_be_disabled()
        self.region.get_by_role("button", name="새로고침", exact=True).click()
        self.settled()
        self.expect(self.region.locator("[data-schedule-id]")).to_have_count(1)
        self.expect(self.create_button()).to_be_disabled()
        self.assertEqual([item["action"] for item in self.fixture.snapshot()["calls"]], ["create"])

    def test_validation_error_preserves_form_and_does_not_repeat_writes(self):
        self.open("empty")
        self.region.get_by_label("Timezone", exact=True).fill("Asia/Seoul")
        self.fixture.fail_schedule = (400, "VALIDATION_FAILED")
        self.create_button().click()
        self.settled()
        self.expect(self.status()).to_contain_text("VALIDATION_FAILED")
        self.expect(self.region.get_by_label("Timezone", exact=True)).to_have_value("Asia/Seoul")
        self.expect(self.create_button()).to_be_enabled()
        self.assertEqual([item["action"] for item in self.fixture.snapshot()["calls"]], ["create"])

    def test_keyboard_access_and_live_status(self):
        self.fixture.configure("empty")
        self.visit()
        toggle = self.region.get_by_role("button", name="발행 예약", exact=True)
        toggle.focus()
        self.page.keyboard.press("Enter")
        self.settled()
        self.expect(self.region.get_by_role("button", name="예약 닫기", exact=True)).to_have_attribute("aria-expanded", "true")
        self.region.get_by_role("button", name="새로고침", exact=True).focus()
        self.page.keyboard.press("Tab")
        self.expect(self.region.get_by_label("Action", exact=True)).to_be_focused()
        self.region.get_by_label("Action", exact=True).select_option("publish")
        self.create_button().focus()
        self.page.keyboard.press("Enter")
        self.settled()
        self.expect(self.status()).to_have_attribute("aria-live", "polite")
        self.expect(self.status()).to_contain_text("예약을 생성했습니다.")
        self.assertEqual(len(self.fixture.snapshot()["calls"]), 1)

    def test_long_uuid_layout_at_desktop_and_narrow_widths(self):
        self.open("publish")
        for width in [1440, 375, 320]:
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": 960})
                self.region.scroll_into_view_if_needed()
                self.expect(self.row().get_by_text(REVISION_1, exact=True)).to_be_visible()
                self.expect(self.row()).to_contain_text(SCHEDULE_ID)
                metrics = self.region.evaluate("""node => {
                    const rect = node.getBoundingClientRect();
                    return {left: rect.left, right: rect.right, width: rect.width,
                        viewport: document.documentElement.clientWidth,
                        overflow: [...node.querySelectorAll('article, p, label, input, select')]
                            .filter(el => el.scrollWidth > el.clientWidth + 2)
                            .map(el => ({tag: el.tagName, text: el.textContent, width: el.clientWidth, scroll: el.scrollWidth}))};
                }""")
                self.assertGreaterEqual(metrics["left"], -1, metrics)
                self.assertLessEqual(metrics["right"], metrics["viewport"] + 1, metrics)
                self.assertEqual(metrics["overflow"], [], metrics)
                self.evidence(f"scheduler-width-{width}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/r05f-scheduler-browser")
    parser.add_argument("--chromium-executable", default=None)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report = {"checkout_sha": os.environ.get("GITHUB_SHA"),
              "workflow_event": os.environ.get("GITHUB_EVENT_NAME"),
              "scope": "Actual Next.js production Scheduler + Chromium; loopback API/Auth/DB fixtures",
              "status": "not_run", "real_authenticated_http": "separate Scheduler Legacy HTTP Gate"}
    fixture = process = log = None
    try:
        pnpm = shutil.which("pnpm")
        if not pnpm:
            raise RuntimeError("The repository's pinned pnpm toolchain is required")
        from playwright.sync_api import sync_playwright
        fixture = SchedulerFixtureApi(APP_URL)
        fixture.start()
        environment = {**os.environ, "NEXT_PUBLIC_ATLAS_API_URL": fixture.url + "/api",
                       "ATLAS_API_INTERNAL_URL": fixture.url + "/api",
                       "NEXT_PUBLIC_ATLAS_CSRF_COOKIE_NAME": "atlas_admin_csrf", "NEXT_TELEMETRY_DISABLED": "1"}
        with (output / "next-build.log").open("w") as build_log:
            subprocess.run([pnpm, "--filter", "@atlas/admin-web", "build"], cwd=ROOT, env=environment,
                           stdout=build_log, stderr=subprocess.STDOUT, check=True, timeout=600)
        log = (output / "next-start.log").open("w")
        process = subprocess.Popen([pnpm, "--filter", "@atlas/admin-web", "exec", "next", "start",
                                    "--hostname", "127.0.0.1", "--port", "3100"], cwd=ROOT, env=environment,
                                   stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        wait_for_app(process)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=args.chromium_executable)
            try:
                SchedulerBrowserTests.fixture = fixture
                SchedulerBrowserTests.browser = browser
                SchedulerBrowserTests.output = output
                suite = unittest.defaultTestLoader.loadTestsFromTestCase(SchedulerBrowserTests)
                if suite.countTestCases() != 14:
                    raise AssertionError("Expected all 14 focused Scheduler tests")
                result = unittest.TextTestRunner(verbosity=2).run(suite)
                passed = result.wasSuccessful() and result.testsRun == 14 and not result.skipped
                report.update(status="passed" if passed else "failed", tests_run=result.testsRun,
                              failures=len(result.failures), errors=len(result.errors), skipped=len(result.skipped),
                              browser=browser.version)
            finally:
                browser.close()
        return 0 if report["status"] == "passed" else 1
    except Exception as error:
        report.update(status="preparation_failed", error=str(error))
        print(json.dumps(report, ensure_ascii=False))
        return 1
    finally:
        if process:
            terminate(process)
        if log:
            log.close()
        if fixture:
            fixture.close()
        report["source_sha256"] = {
            name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
            for name in ["apps/admin-web/src/features/eventing/publication-scheduler.tsx",
                         "apps/admin-web/src/features/eventing/publication-scheduler.module.css",
                         "apps/admin-web/src/features/eventing/publication-schedule-presentation.ts",
                         "scripts/testing/browser/scheduler_browser.py",
                         "scripts/testing/browser/scheduler_fixture.py"]
        }
        (output / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    raise SystemExit(main())
