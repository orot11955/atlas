'use client';

import { useCallback, useMemo, useState } from 'react';

import { loadAssets, loadAssetVariants } from '../media/asset-api';
import type { Asset, AssetVariant } from '../media/asset-types';
import type { ContentCoverAsset } from './content-types';
import styles from './content.module.css';

export function ContentCoverAssetPicker({
  disabled,
  value,
  onChange,
}: Readonly<{
  disabled: boolean;
  value: ContentCoverAsset | null;
  onChange: (cover: ContentCoverAsset | null) => void;
}>) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<readonly Asset[]>([]);
  const [selected, setSelected] = useState<Asset>();
  const [variants, setVariants] = useState<readonly AssetVariant[]>([]);
  const [altText, setAltText] = useState(value?.altText ?? '');
  const [caption, setCaption] = useState(value?.caption ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const previewVariant = useMemo(
    () =>
      variants.find((variant) => variant.key === 'webp-768') ??
      variants.find((variant) => variant.key === 'webp-320') ??
      variants.at(0),
    [variants],
  );

  const reloadAssets = useCallback(async () => {
    setLoading(true);
    setError(undefined);

    try {
      const items = (await loadAssets()).filter(
        (asset) => asset.status === 'ready' && asset.archivedAt === null,
      );
      setAssets(items);

      const current = value ? items.find((asset) => asset.id === value.assetId) : undefined;

      if (current) {
        setSelected(current);
        setAltText(value?.altText ?? defaultAltText(current.originalFileName));
        setCaption(value?.caption ?? '');
        setVariants(await loadAssetVariants(current.id));
      } else if (value) {
        setError('현재 Cover Asset은 Archive되었거나 더 이상 READY 상태가 아닙니다.');
      }
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setLoading(false);
    }
  }, [value]);

  function toggle() {
    if (open) {
      setOpen(false);
      setSelected(undefined);
      setVariants([]);
      setAltText(value?.altText ?? '');
      setCaption(value?.caption ?? '');
      setError(undefined);
      return;
    }

    setOpen(true);
    void reloadAssets();
  }

  async function selectAsset(asset: Asset) {
    setSelected(asset);
    setVariants([]);
    setAltText(
      value?.assetId === asset.id ? value.altText : defaultAltText(asset.originalFileName),
    );
    setCaption(value?.assetId === asset.id ? (value.caption ?? '') : '');
    setLoading(true);
    setError(undefined);

    try {
      setVariants(await loadAssetVariants(asset.id));
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setLoading(false);
    }
  }

  function apply() {
    if (!selected || !altText.trim() || variants.length === 0) {
      return;
    }

    onChange({
      assetId: selected.id,
      altText: altText.trim(),
      ...(caption.trim() ? { caption: caption.trim() } : {}),
    });
    setOpen(false);
  }

  function remove() {
    onChange(null);
    setSelected(undefined);
    setVariants([]);
    setAltText('');
    setCaption('');
    setOpen(false);
  }

  return (
    <div className={styles.assetPicker}>
      <div className={styles.actions}>
        <button className={styles.secondary} disabled={disabled} type="button" onClick={toggle}>
          {open ? 'Cover Picker 닫기' : value ? 'Cover 변경' : 'Cover 선택'}
        </button>
        {value ? (
          <button className={styles.danger} disabled={disabled} type="button" onClick={remove}>
            Cover 제거
          </button>
        ) : null}
      </div>

      {value && !open ? (
        <p className={styles.muted}>
          Cover Asset <code>{value.assetId.slice(0, 12)}…</code> · {value.altText}
        </p>
      ) : null}

      {open ? (
        <div className={styles.assetPickerPanel}>
          <div className={styles.assetPickerHeader}>
            <div>
              <strong>READY Cover Asset</strong>
              <p>Archive되지 않은 Public Variant만 Preview합니다.</p>
            </div>
            <button
              className={styles.secondary}
              disabled={loading}
              type="button"
              onClick={reloadAssets}
            >
              새로고침
            </button>
          </div>

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.assetPickerGrid}>
            <div className={styles.assetPickerList}>
              {loading && assets.length === 0 ? (
                <p className={styles.muted}>Asset을 불러오는 중…</p>
              ) : null}
              {!loading && assets.length === 0 ? (
                <p className={styles.muted}>선택 가능한 READY Asset이 없습니다.</p>
              ) : null}
              {assets.map((asset) => (
                <button
                  className={styles.assetPickerItem}
                  data-selected={selected?.id === asset.id}
                  key={asset.id}
                  type="button"
                  onClick={() => selectAsset(asset)}
                >
                  <strong>{asset.originalFileName}</strong>
                  <span>
                    {formatDimensions(asset)} ·{' '}
                    {formatBytes(asset.actualSize ?? asset.expectedSize)}
                  </span>
                </button>
              ))}
            </div>

            <div className={styles.assetPickerDetail}>
              {selected ? (
                <>
                  <div className={styles.assetPreview}>
                    {previewVariant ? (
                      <img
                        alt=""
                        height={previewVariant.height}
                        src={previewVariant.publicUrl}
                        width={previewVariant.width}
                      />
                    ) : (
                      <span>
                        {loading ? 'Variant를 불러오는 중…' : 'Public Variant가 없습니다.'}
                      </span>
                    )}
                  </div>
                  <label className={styles.field}>
                    <span>Alt Text</span>
                    <input
                      maxLength={300}
                      value={altText}
                      onChange={(event) => setAltText(event.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Caption</span>
                    <input
                      maxLength={1_000}
                      value={caption}
                      onChange={(event) => setCaption(event.target.value)}
                    />
                  </label>
                  <button
                    className={styles.button}
                    disabled={!altText.trim() || variants.length === 0 || loading}
                    type="button"
                    onClick={apply}
                  >
                    Cover로 설정
                  </button>
                </>
              ) : (
                <p className={styles.muted}>왼쪽에서 Asset을 선택하세요.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function defaultAltText(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/u, '')
    .replace(/[-_]+/gu, ' ')
    .trim();
}

function formatDimensions(asset: Asset): string {
  return asset.width && asset.height ? `${asset.width}×${asset.height}` : '크기 확인 중';
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`;
  return `${(value / 1_048_576).toFixed(1)} MiB`;
}

function readError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Cover Asset을 불러오지 못했습니다.';
}
