# Content Editor browser regression gate

This gate builds and starts the real Next.js admin application, then drives its
actual ContentEditor route in Chromium. A separate loopback HTTP fixture handles
API/session requests. It does not add test routes or auth bypasses to Atlas.

**This is UI integration testing with a fake API, not a production API, MFA,
CSRF, PostgreSQL, or MinIO end-to-end acceptance test.** Existing data gates remain
required. The fixture's cookie/CSRF checks validate the fixture protocol only.

## Run locally

Use the repository's Node 24 and pnpm 11.24.0 toolchain and Python 3.11 or later.
From the repository root, with ports 3100 and 4101 unused:

```sh
pnpm install --frozen-lockfile
python3 -m venv /tmp/atlas-editor-browser-venv
/tmp/atlas-editor-browser-venv/bin/pip install -r scripts/testing/browser/requirements.txt
/tmp/atlas-editor-browser-venv/bin/python -m playwright install chromium
python3 -m unittest discover -s scripts/testing/browser -p test_fixture.py -v
/tmp/atlas-editor-browser-venv/bin/python scripts/testing/browser/editor_browser.py
```

Linux CI also installs browser system dependencies using
`python -m playwright install --with-deps chromium`. An existing system Chromium
can be selected with `--chromium-executable /usr/bin/chromium`.

The driver builds the app with the fixture URL, starts Next.js on loopback,
creates a fresh browser context per case, and terminates its child processes on
exit. It never connects to an existing production app or database. The build
replaces `apps/admin-web/.next` with a fixture-configured test build. Never deploy
that build: rebuild with production settings for a real release.

Reports and traces go to `tmp/r01-browser/` (ignored by Git). `--output` selects
another report directory. The process exits nonzero if dependencies are missing,
Next.js cannot start, a test fails, or a page raises an unhandled runtime error.
No test is counted as passed when preparation fails.

## Cases

1. Manual A save in flight, B edit: B remains dirty and server version advances.
2. Autosave followed by READY: pending save, newer draft, then exact revision.
3. Version conflict: input preserved and automatic writes remain paused.
4. Confirmed validation rejection: edit and retry without discarding the draft.
5. Consecutive READY clicks: one immutable revision command.
6. Actual Next.js link navigation: late response cannot change the next editor.
7. Archive: flush current draft before archiving, then disable editing.

Fixture contract tests verify that controllable delayed requests and injected
errors do not create false-positive browser results. Tests reject unexpected
routes and version mismatches instead of automatically returning success.

## Evidence boundary for the 2026-09-05 continuation

The fixture contract tests passed locally. The browser driver and permanent
workflow were added, but the real Next.js browser suite was **not executed** in
this environment: pnpm and the locked React/Next.js dependencies were unavailable,
and registry DNS resolution failed. The separate offline coordinator harness is
not a substitute for this gate. Keep R01 unmerged until this gate and normal CI
pass on the same final head.
