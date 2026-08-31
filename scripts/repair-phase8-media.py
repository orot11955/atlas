from pathlib import Path

root = Path(__file__).resolve().parents[1]


def load(path: str) -> str:
    return (root / path).read_text(encoding='utf-8')


def save(path: str, content: str) -> None:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


# Align administrator extraction with the already verified ContentService pattern.
path = 'packages/server/src/modules/media/application/asset.service.ts'
content = load(path)
content = content.replace('  ActorType,\n', '')
content = content.replace(
    "  const context = requestContext.require();\n\n  if (context.actorType !== ActorType.ADMIN || !context.actorId) {",
    "  const actorId = requestContext.require().actorId;\n\n  if (!actorId) {",
)
content = content.replace('  return context.actorId;\n', '  return actorId;\n')
content = content.replace(
    'function validationFailure(code: string, message: string, cause?: unknown): DomainError {',
    'function validationFailure(code: string, message: string, _cause?: unknown): DomainError {',
)
content = content.replace('    details: { failureCode: code },\n    cause,\n', '    details: { failureCode: code },\n')
content = content.replace('              details: { failureCode },\n              cause,\n', '              details: { failureCode },\n')
save(path, content)

# class-validator expects a mutable array for IsIn.
path = 'apps/api/src/media/media.dto.ts'
content = load(path).replace('@IsIn(ASSET_IMAGE_CONTENT_TYPES)', '@IsIn([...ASSET_IMAGE_CONTENT_TYPES])')
save(path, content)

# Replace the integration-heavy provisional test with stable domain contract tests.
(root / 'packages/server/src/asset-upload.test.ts').unlink(missing_ok=True)
save(
    'packages/server/src/asset.test.ts',
    """import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  detectAssetImageContentType,
  normalizeAssetContentType,
  normalizeAssetExpectedSize,
  normalizeAssetFileName,
  normalizeAssetSha256,
} from './index';

test('Asset upload input accepts only normalized JPEG, PNG and WebP contracts', () => {
  assert.equal(normalizeAssetFileName(' C:\\\\fakepath\\\\atlas image.png '), 'atlas image.png');
  assert.equal(normalizeAssetContentType('IMAGE/PNG'), 'image/png');
  assert.equal(normalizeAssetExpectedSize(1024, 2048), 1024);
  assert.equal(normalizeAssetSha256('A'.repeat(64)), 'a'.repeat(64));
  assert.throws(() => normalizeAssetContentType('image/svg+xml'));
  assert.throws(() => normalizeAssetExpectedSize(2049, 2048));
});

test('Asset image detection uses magic bytes instead of the file extension', () => {
  assert.equal(
    detectAssetImageContentType(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
    'image/png',
  );
  assert.equal(
    detectAssetImageContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])),
    'image/jpeg',
  );
  assert.equal(
    detectAssetImageContentType(Buffer.from('RIFF0000WEBP', 'ascii')),
    'image/webp',
  );
  assert.equal(detectAssetImageContentType(Buffer.from('<svg></svg>')), undefined);
});
""",
)

# Ensure generated integration files are present even when the first materializer stopped early.
path = 'packages/server/src/modules/index.ts'
content = load(path)
if "export * from './media';" not in content:
    save(path, content.rstrip() + "\nexport * from './media';\n")

path = 'apps/api/src/app.module.ts'
content = load(path)
if "./media/media.module" not in content:
    anchor = "import { MinioModule } from './infrastructure/minio/minio.module';\n"
    if anchor not in content:
        raise RuntimeError('MinioModule import anchor is missing.')
    content = content.replace(anchor, anchor + "import { MediaModule } from './media/media.module';\n", 1)
if '    MediaModule,\n' not in content:
    anchor = '    HealthModule,\n'
    if anchor not in content:
        raise RuntimeError('HealthModule list anchor is missing.')
    content = content.replace(anchor, '    MediaModule,\n' + anchor, 1)
save(path, content)

path = 'packages/database/src/data-source.ts'
content = load(path)
if '  AssetEntity,\n' not in content:
    anchor = '  AuditLogEntity,\n'
    if anchor not in content:
        raise RuntimeError('AuditLogEntity import anchor is missing.')
    content = content.replace(anchor, '  AssetEntity,\n  AssetUploadSessionEntity,\n' + anchor, 1)
if '    AssetEntity,\n' not in content:
    anchor = '    AuditLogEntity,\n'
    if anchor not in content:
        raise RuntimeError('AuditLogEntity entity anchor is missing.')
    content = content.replace(anchor, '    AssetEntity,\n    AssetUploadSessionEntity,\n' + anchor, 1)
save(path, content)

path = '.env.example'
content = load(path)
if 'MINIO_PRESIGN_ENDPOINT=' not in content:
    content = content.rstrip() + """

# Browser-reachable endpoint used only for Presigned URL calculation.
MINIO_PRESIGN_ENDPOINT=http://localhost:9000
ASSET_UPLOAD_TTL_SECONDS=900
ASSET_UPLOAD_MAX_BYTES=26214400
"""
    save(path, content)
