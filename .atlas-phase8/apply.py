from __future__ import annotations

import base64
import gzip
import hashlib
import io
import shutil
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARTS = [ROOT / '.atlas-phase8' / f'part-{index:02d}.txt' for index in range(14)]
EXPECTED_SHA256 = 'c777c67468ce5dc0c7897c00597ea5b0fa67b05be4865ba7ddadd7a16bc9444d'
DELETE_PATHS = ['.github/workflows/apply-phase8-media-once.yml', '.github/workflows/export-phase8-source-once.yml', '.github/workflows/finalize-phase8-media-once.yml', '.github/workflows/finalize-phase8-media-v2-once.yml', '.github/workflows/repair-phase8-media-once.yml', 'packages/server/src/asset-upload.test.ts', 'scripts/apply-phase8-media.py', 'scripts/finalize-phase8-media-v2.py', 'scripts/finalize-phase8-media.py', 'scripts/repair-phase8-media.py']

encoded = ''.join(path.read_text(encoding='utf-8').strip() for path in PARTS)
payload = base64.b64decode(encoded, validate=True)
actual = hashlib.sha256(payload).hexdigest()
if actual != EXPECTED_SHA256:
    raise RuntimeError(f'Phase 8 payload checksum mismatch: {actual}')

archive_bytes = gzip.decompress(payload)
root = ROOT.resolve()
with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode='r:') as archive:
    for member in archive.getmembers():
        target = (ROOT / member.name).resolve()
        if target != root and root not in target.parents:
            raise RuntimeError(f'Unsafe archive path: {member.name}')
    archive.extractall(ROOT, filter='data')

for relative in DELETE_PATHS:
    path = ROOT / relative
    if path.is_file() or path.is_symlink():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)

print(f'Applied Phase 8 payload {actual} with {len(DELETE_PATHS)} deletions.')
