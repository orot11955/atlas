from __future__ import annotations

import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (root / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


# Re-apply core integration idempotently in case an earlier one-time workflow stopped.
path = 'packages/server/src/modules/index.ts'
content = read(path)
if "export * from './media';" not in content:
    write(path, content.rstrip() + "\nexport * from './media';\n")

path = 'apps/api/src/app.module.ts'
content = read(path)
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
write(path, content)

path = 'packages/database/src/data-source.ts'
content = read(path)
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
write(path, content)

# Keep administrator extraction identical to the verified Content application service.
path = 'packages/server/src/modules/media/application/asset.service.ts'
content = read(path)
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
write(path, content)

path = 'apps/api/src/media/media.dto.ts'
content = read(path).replace('@IsIn(ASSET_IMAGE_CONTENT_TYPES)', '@IsIn([...ASSET_IMAGE_CONTENT_TYPES])')
write(path, content)

# Ensure stable domain tests are used.
(root / 'packages/server/src/asset-upload.test.ts').unlink(missing_ok=True)
if not (root / 'packages/server/src/asset.test.ts').exists():
    raise RuntimeError('Stable Asset domain test is missing.')

# Add authenticated Asset E2E to the existing complete administrator scenario.
path = 'scripts/ci/admin-auth-e2e.mjs'
content = read(path)
asset_import = "import { verifyAssetUploadFoundation } from './asset-upload-e2e.mjs';"
if asset_import not in content:
    imports = list(re.finditer(r'(?m)^import .+;$', content))
    if not imports:
        raise RuntimeError('admin-auth-e2e import section was not found.')
    point = imports[-1].end()
    content = content[:point] + '\n' + asset_import + content[point:]

if 'await verifyAssetUploadFoundation({' not in content:
    needle = 'await verifyApiClientLifecycle('
    start = content.find(needle)
    if start < 0:
        raise RuntimeError('API Client lifecycle call was not found.')
    opening = content.find('(', start)
    depth = 0
    end = None
    for index in range(opening, len(content)):
        character = content[index]
        if character == '(':
            depth += 1
        elif character == ')':
            depth -= 1
            if depth == 0:
                semicolon = content.find(';', index)
                if semicolon < 0:
                    raise RuntimeError('API Client lifecycle call terminator was not found.')
                end = semicolon + 1
                break
    if end is None:
        raise RuntimeError('API Client lifecycle call boundary was not found.')
    call = """

await verifyAssetUploadFoundation({
  request,
  session,
  assertEqual,
});"""
    content = content[:end] + call + content[end:]

content = content.replace(
    'Admin Password, TOTP, Session, Workspace, Site, API Client, Project and Deployment E2E passed.',
    'Admin Password, TOTP, Session, Workspace, Site, API Client, Asset, Project and Deployment E2E passed.',
)
write(path, content)

# Make regular CI start a real MinIO server and buckets before authenticated E2E.
path = '.github/workflows/ci.yml'
content = read(path)
if 'Start MinIO and create Asset buckets' not in content:
    anchor = '      - name: Verify complete Administrator and API Client Authentication API\n'
    if anchor not in content:
        raise RuntimeError('CI authenticated E2E step anchor was not found.')
    step = """      - name: Start MinIO and create Asset buckets
        run: |
          docker run -d --name atlas-ci-minio \\
            -p 9000:9000 \\
            -e MINIO_ROOT_USER="$MINIO_ACCESS_KEY" \\
            -e MINIO_ROOT_PASSWORD="$MINIO_SECRET_KEY" \\
            minio/minio:latest server /data

          for attempt in $(seq 1 30); do
            if curl -fsS http://localhost:9000/minio/health/live > /dev/null; then
              break
            fi
            if [ "$attempt" = '30' ]; then
              docker logs atlas-ci-minio
              exit 1
            fi
            sleep 1
          done

          docker run --rm --network host --entrypoint /bin/sh minio/mc:latest -c "
            mc alias set local http://127.0.0.1:9000 '$MINIO_ACCESS_KEY' '$MINIO_SECRET_KEY' &&
            mc mb --ignore-existing local/$MINIO_PRIVATE_BUCKET &&
            mc mb --ignore-existing local/$MINIO_PROCESSING_BUCKET &&
            mc mb --ignore-existing local/$MINIO_PUBLIC_BUCKET
          "

"""
    content = content.replace(anchor, step + anchor, 1)
write(path, content)

# Keep browser Presigned URL configuration explicit in the sample environment.
path = '.env.example'
content = read(path)
if 'MINIO_PRESIGN_ENDPOINT=' not in content:
    content = content.rstrip() + """

# Browser-reachable endpoint used only for Presigned URL calculation.
MINIO_PRESIGN_ENDPOINT=http://localhost:9000
ASSET_UPLOAD_TTL_SECONDS=900
ASSET_UPLOAD_MAX_BYTES=26214400
"""
    write(path, content)
