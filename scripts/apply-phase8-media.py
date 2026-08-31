from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    if new in content:
        return
    if old not in content:
        raise RuntimeError(f"Patch anchor not found in {path}: {old!r}")
    write(path, content.replace(old, new, 1))


# Export the Media module from @atlas/server.
modules_index = "packages/server/src/modules/index.ts"
content = read(modules_index)
if "export * from './media';" not in content:
    if not content.endswith("\n"):
        content += "\n"
    content += "export * from './media';\n"
    write(modules_index, content)

# Register Asset entities in the TypeORM CLI DataSource.
data_source = "packages/database/src/data-source.ts"
content = read(data_source)
if "AssetEntity," not in content:
    anchor = "  AuditLogEntity,\n"
    if anchor not in content:
        raise RuntimeError("Asset import anchor was not found in data-source.ts")
    content = content.replace(
        anchor,
        "  AssetEntity,\n  AssetUploadSessionEntity,\n" + anchor,
        1,
    )
if "    AssetEntity," not in content:
    anchor = "    AuditLogEntity,\n"
    if anchor not in content:
        raise RuntimeError("Asset entity-list anchor was not found in data-source.ts")
    content = content.replace(
        anchor,
        "    AssetEntity,\n    AssetUploadSessionEntity,\n" + anchor,
        1,
    )
write(data_source, content)

# Wire the NestJS MediaModule.
app_module = "apps/api/src/app.module.ts"
content = read(app_module)
if "./media/media.module" not in content:
    anchor = "import { MinioModule } from './infrastructure/minio/minio.module';\n"
    if anchor not in content:
        raise RuntimeError("MediaModule import anchor was not found in app.module.ts")
    content = content.replace(
        anchor,
        anchor + "import { MediaModule } from './media/media.module';\n",
        1,
    )
if "    MediaModule," not in content:
    anchor = "    HealthModule,\n"
    if anchor not in content:
        raise RuntimeError("MediaModule list anchor was not found in app.module.ts")
    content = content.replace(anchor, "    MediaModule,\n" + anchor, 1)
write(app_module, content)

# Add an Assets navigation item by cloning the existing Contents item so
# permission and optional icon fields remain aligned with the current Shell.
navigation = "apps/admin-web/src/components/admin/admin-navigation.tsx"
content = read(navigation)
if "/admin/assets" not in content:
    pattern = re.compile(r"(?P<indent>\s*)\{(?:(?!\n\s*\},).)*href:\s*['\"]\/admin\/contents['\"](?:(?!\n\s*\},).)*\n\s*\},", re.DOTALL)
    match = pattern.search(content)
    if match:
        block = match.group(0)
        asset_block = block.replace("/admin/contents", "/admin/assets", 1)
        asset_block = re.sub(
            r"(label:\s*['\"])(?:Contents|Content|콘텐츠)(['\"])",
            r"\1Assets\2",
            asset_block,
            count=1,
        )
        content = content[: match.end()] + "\n" + asset_block + content[match.end() :]
        write(navigation, content)

# Document browser-reachable presigning and limits without making them
# mandatory typed environment keys in this first vertical slice.
env_example = ".env.example"
content = read(env_example)
addition = """
# Browser-reachable endpoint used only to calculate Presigned URLs.
# The API continues to use MINIO_ENDPOINT for runtime storage operations.
MINIO_PRESIGN_ENDPOINT=http://localhost:9000
ASSET_UPLOAD_TTL_SECONDS=900
ASSET_UPLOAD_MAX_BYTES=26214400
"""
if "MINIO_PRESIGN_ENDPOINT=" not in content:
    content = content.rstrip() + "\n\n" + addition.lstrip()
    write(env_example, content)

# DomainError does not need to retain a raw storage error. Keep internal
# causes out of application error payloads and logs at this boundary.
asset_service = "packages/server/src/modules/media/application/asset.service.ts"
content = read(asset_service)
content = content.replace(
    "function validationFailure(code: string, message: string, cause?: unknown): DomainError {\n",
    "function validationFailure(code: string, message: string, _cause?: unknown): DomainError {\n",
)
content = content.replace("    details: { failureCode: code },\n    cause,\n", "    details: { failureCode: code },\n")
content = content.replace("              details: { failureCode },\n              cause,\n", "              details: { failureCode },\n")
write(asset_service, content)
