'use client';

import { useEffect, useRef, useState } from 'react';

import { AtlasApiError } from '../../lib/api';
import { completeAssetUpload, createAssetUploadSession, loadAssets } from './asset-api';
import type { Asset, AssetContentType } from './asset-types';
import styles from './asset.module.css';

const SUPPORTED_CONTENT_TYPES = new Set<AssetContentType>([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function AssetManager() {
  const [assets, setAssets] = useState<readonly Asset[]>([]);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setError(undefined);
    try {
      setAssets(await loadAssets());
    } catch (caught) {
      setError(readError(caught));
    }
  }

  async function upload() {
    const file = fileInput.current?.files?.[0];

    if (!file) {
      setError('업로드할 이미지 파일을 선택하세요.');
      return;
    }

    if (!SUPPORTED_CONTENT_TYPES.has(file.type as AssetContentType)) {
      setError('JPEG, PNG 또는 WebP 이미지만 업로드할 수 있습니다.');
      return;
    }

    setWorking(true);
    setError(undefined);

    try {
      setProgress('SHA-256 계산 중…');
      const sha256 = await calculateSha256(file);
      setProgress('Private Upload Session 생성 중…');
      const session = await createAssetUploadSession({
        fileName: file.name,
        contentType: file.type as AssetContentType,
        size: file.size,
        sha256,
      });

      setProgress('MinIO에 원본 업로드 중…');
      const uploadResponse = await fetch(session.upload.url, {
        method: session.upload.method,
        headers: session.upload.headers,
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Object upload failed with HTTP ${uploadResponse.status}.`);
      }

      setProgress('서버 검증 및 원본 확정 중…');
      await completeAssetUpload(session.uploadSession.id);
      fileInput.current.value = '';
      await refresh();
      setProgress('업로드와 서버 검증이 완료되었습니다.');
    } catch (caught) {
      setError(readError(caught));
      setProgress(undefined);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">MEDIA · PRIVATE ORIGINAL</p>
          <h1>Asset Upload</h1>
          <p>
            Browser는 Presigned PUT으로 MinIO에 직접 업로드하고, Atlas API가 크기·SHA-256·이미지
            형식을 다시 검증합니다.
          </p>
        </div>
      </header>

      <section className={styles.panel}>
        <h2>새 이미지 업로드</h2>
        <p className={styles.muted}>JPEG, PNG, WebP · 최대 25 MiB</p>
        <div className={styles.uploadRow}>
          <input
            ref={fileInput}
            accept="image/jpeg,image/png,image/webp"
            disabled={working}
            type="file"
          />
          <button className={styles.button} disabled={working} type="button" onClick={upload}>
            {working ? '처리 중…' : '업로드'}
          </button>
        </div>
        <div aria-live="polite">
          {progress ? <p className={styles.success}>{progress}</p> : null}
          {error ? <p className={styles.error}>{error}</p> : null}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.listHeader}>
          <div>
            <h2>Assets</h2>
            <p className={styles.muted}>Bucket과 Object Key는 관리자 응답에도 노출하지 않습니다.</p>
          </div>
          <button className={styles.secondary} disabled={working} type="button" onClick={refresh}>
            새로고침
          </button>
        </div>

        <div className={styles.assets}>
          {assets.length === 0 ? <div className={styles.empty}>아직 Asset이 없습니다.</div> : null}
          {assets.map((asset) => (
            <article className={styles.asset} key={asset.id}>
              <div>
                <strong>{asset.originalFileName}</strong>
                <p className={styles.muted}>
                  {formatBytes(asset.actualSize ?? asset.expectedSize)} ·{' '}
                  {asset.detectedContentType ?? asset.declaredContentType}
                </p>
              </div>
              <span className={styles.pill} data-status={asset.status}>
                {asset.status}
              </span>
              <code>{asset.sha256.slice(0, 12)}…</code>
              <time dateTime={asset.createdAt}>{formatDate(asset.createdAt)}</time>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

async function calculateSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function readError(error: unknown): string {
  if (error instanceof AtlasApiError) {
    return `${error.problem.detail}${error.requestId ? ` · 요청 ID ${error.requestId}` : ''}`;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Asset 요청을 처리하지 못했습니다.';
}
