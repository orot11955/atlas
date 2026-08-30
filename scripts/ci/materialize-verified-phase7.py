from __future__ import annotations

import base64
import hashlib
import io
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAYLOAD_SHA256 = "42b5fb9338c12c3c7b5fddf2d12158f48272af977620b368ecb999fb1029cc2d"
PARTS = [ROOT / ".phase7-payload" / f"part-{index:02}" for index in range(5)]
EXPECTED_FILES = {
    ".github/workflows/ci.yml",
    "apps/admin-web/src/features/content/content-api.ts",
    "apps/admin-web/src/features/content/content-editor.tsx",
    "apps/admin-web/src/features/content/content-publication-manager.tsx",
    "apps/admin-web/src/features/content/content-types.ts",
    "apps/admin-web/src/features/content/content.module.css",
    "apps/api/src/api-clients/api-client.module.ts",
    "apps/api/src/api-clients/api-client.request.ts",
    "apps/api/src/api-clients/delivery-content.controller.ts",
    "apps/api/src/content/content-publication.controller.ts",
    "apps/api/src/content/content-publication.dto.ts",
    "apps/api/src/content/content-publication.presenter.ts",
    "apps/api/src/content/content.module.ts",
    "apps/api/src/content/content.tokens.ts",
    "docs/implementation-roadmap.md",
    "docs/implementation/phase-7-content-publication-delivery.md",
    "packages/database/src/data-source.ts",
    "packages/database/src/migrations/1788076200000-CreateContentPublicationDelivery.ts",
    "packages/server/src/content-publication.test.ts",
    "packages/server/src/modules/content/application/content-publication.service.ts",
    "packages/server/src/modules/content/domain/content-publication.ts",
    "packages/server/src/modules/content/index.ts",
    "packages/server/src/modules/content/infrastructure/persistence/content-publication.entities.ts",
    "packages/server/src/modules/content/infrastructure/persistence/typeorm-content-publication.repository.ts",
    "packages/server/src/modules/content/ports/content-publication.repository.ts",
    "scripts/ci/admin-auth-e2e.mjs",
    "scripts/ci/content-publication-delivery-e2e.mjs",
}
CLEANUP_FILES = [
    *(f".phase7-payload/part-{index:02}" for index in range(5)),
    ".github/workflows/export-phase7-base-once.yml",
    ".github/workflows/export-phase7-deps-once.yml",
    ".github/workflows/export-phase7-scaffolds-once.yml",
    ".github/workflows/finalize-phase7-once.yml",
    ".github/workflows/materialize-phase7-once.yml",
    ".github/workflows/repair-phase7-once.yml",
    ".github/workflows/materialize-verified-phase7-once.yml",
    "scripts/ci/phase7-delivery-scaffold.py",
    "scripts/ci/phase7-scaffold.py",
    "scripts/ci/phase7-wiring-scaffold.py",
    "scripts/ci/materialize-verified-phase7.py",
]


def main() -> None:
    payload_text = "".join(path.read_text(encoding="utf-8").strip() for path in PARTS)
    payload = base64.b64decode(payload_text, validate=True)
    digest = hashlib.sha256(payload).hexdigest()

    if digest != PAYLOAD_SHA256:
        raise RuntimeError(f"Phase 7 payload checksum mismatch: {digest}")

    root = ROOT.resolve()
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        members = archive.getmembers()
        archive_files = {member.name for member in members if member.isfile()}

        if archive_files != EXPECTED_FILES:
            missing = sorted(EXPECTED_FILES - archive_files)
            unexpected = sorted(archive_files - EXPECTED_FILES)
            raise RuntimeError(
                f"Phase 7 payload file set mismatch; missing={missing}, unexpected={unexpected}"
            )

        for member in members:
            target = (ROOT / member.name).resolve()
            if target != root and root not in target.parents:
                raise RuntimeError(f"Unsafe archive member: {member.name}")
            if member.issym() or member.islnk():
                raise RuntimeError(f"Archive links are not allowed: {member.name}")

        archive.extractall(ROOT, filter="data")

    for relative in CLEANUP_FILES:
        path = ROOT / relative
        if path.exists() or path.is_symlink():
            path.unlink()

    payload_directory = ROOT / ".phase7-payload"
    if payload_directory.exists():
        payload_directory.rmdir()


if __name__ == "__main__":
    main()
