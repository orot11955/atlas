from __future__ import annotations

import base64
import hashlib
import io
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAYLOAD_SHA256 = "42b5fb9338c12c3c7b5fddf2d12158f48272af977620b368ecb999fb1029cc2d"
PART_SHA256 = {
    ".phase7-payload/part-00-00": "a2a02451a856817965d657aff9872e62abbcbed9a4900282b38317303ad31155",
    ".phase7-payload/part-00-01": "7d287e1d881c8558504da2fe181a4e66a867955ba625de2752a2bfac02c8997b",
    ".phase7-payload/part-00-02": "71d8d457d694fa77890eff281251b62e469f7386705036c6ae337947b4ca1b3f",
    ".phase7-payload/part-00-03": "88e7159450515e44c866820625148e78e8e3b025e2395c7736ebe1779651079c",
    ".phase7-payload/part-01": "c8bd227e63775bd962abda8f3e21fe11bd0f8e20e169bfba0673215a0bdd4ef3",
    ".phase7-payload/part-02": "9a0db9635997feb6297b89375ac6630d311a0fe4ff9b55fb33442b583baea426",
    ".phase7-payload/part-03-00": "4db96d07ccc4ea92ed1c47a97e592edfabbcf0cb8b538ecab64699eb6d01c8df",
    ".phase7-payload/part-03-01": "b7a5e8d74a7942789ea8e817505bef0c04dee9cc8cf3c3baad0cf6d3a003bd41",
    ".phase7-payload/part-03-02": "8da8d68c8dac90751aef189b4631e7808d8732eb00bb6d825319df19bbaff45f",
    ".phase7-payload/part-03-03": "365f8fd81cfc04020d57992b7f2db9c8537e801ac25f8a22e404a211efce4e6c",
    ".phase7-payload/part-04": "731f8fa488219f2fd397deeb55f467b921a8294071103e7ea0fc3f0da0c35fd4",
}
PARTS = [ROOT / relative for relative in PART_SHA256]
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
    ".phase7-payload/part-00",
    ".phase7-payload/part-03",
    *PART_SHA256,
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


def read_verified_parts() -> str:
    verified: list[str] = []

    for relative, expected_digest in PART_SHA256.items():
        path = ROOT / relative
        content = path.read_text(encoding="utf-8").strip()
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()

        if digest != expected_digest:
            raise RuntimeError(
                f"Phase 7 payload part checksum mismatch for {relative}: {digest}"
            )

        verified.append(content)

    return "".join(verified)


def main() -> None:
    payload_text = read_verified_parts()
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
