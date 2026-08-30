# Phase 6 merged-tree verification failure

- quality: failure
- migration: skipped
- bootstrap: skipped
- harness: skipped
- e2e: skipped
- immutable: skipped

## phase6-merged-quality.log
```text
$ prettier --check .
Checking formatting...
[[31merror[39m] .github/workflows/finalize-phase6-progress-once.yml: SyntaxError: A block sequence may not be used as an implicit map key (66:1)
[[31merror[39m]   64 |
[[31merror[39m]   65 |           completed = '''### Phase 6. Content Draft & Revision
[[31merror[39m] > 66 |
[[31merror[39m]      | ^
[[31merror[39m] > 67 | - Workspace·Site-scoped Content
[[31merror[39m]      | ^
[[31merror[39m]   68 | - Mutable ContentDraft와 독립 Draft Version
[[31merror[39m]   69 | - 1.2초 Debounce Markdown Autosave
[[31merror[39m]   70 | - Content Metadata Version과 Draft Version 분리
Error occurred when checking code style in the above file.
[ELIFECYCLE] Command failed with exit code 2.
```
