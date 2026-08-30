import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DomainError, renderMarkdownPreview, validateReadyDraft } from './index';

test('Markdown preview escapes raw HTML and removes unsafe links', () => {
  const preview = renderMarkdownPreview(`
# Atlas

<script>alert('xss')</script>

[unsafe](javascript:alert(1))
[safe](https://example.com)
`);

  assert.match(preview.html, /<h1>Atlas<\/h1>/u);
  assert.doesNotMatch(preview.html, /<script>/u);
  assert.match(preview.html, /&lt;script&gt;/u);
  assert.doesNotMatch(preview.html, /javascript:/u);
  assert.match(preview.html, /href="https:\/\/example\.com"/u);
  assert.deepEqual(preview.warnings, ['raw_html_escaped', 'unsafe_link_removed']);
});

test('READY validation requires a title and meaningful Markdown body', () => {
  assert.throws(
    () =>
      validateReadyDraft({
        title: '',
        bodyMarkdown: '# Tiny',
      }),
    DomainError,
  );

  assert.doesNotThrow(() =>
    validateReadyDraft({
      title: 'Atlas Content Workflow',
      summary: 'Draft and immutable Revision boundary',
      bodyMarkdown: 'This body contains enough meaningful content to create a READY revision.',
    }),
  );
});
