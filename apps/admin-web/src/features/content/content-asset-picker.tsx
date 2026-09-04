'use client';

import { useCallback, useMemo, useState } from 'react';

import { loadAssets, loadAssetVariants } from '../media/asset-api';
import type { Asset, AssetVariant } from '../media/asset-types';
import styles from './content.module.css';

export function ContentAssetPicker({
  disabled,
  onInsert,
}: Readonly<{
  disabled: boolean;
  onInsert: (markdown: string) => void;
}>) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<readonly Asset[]>([]);
  const [selected, setSelected] = useState<Asset>();
  const [variants, setVariants] = useState<readonly AssetVariant[]>([]);
  const [altText, setAltText] = useState('');
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
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
      const items = await loadAssets();
      setAssets(items.filter((asset) => asset.status === 'ready'));
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, []);

  function togglePicker() {
    const nextOpen = !open;
    setOpen(nextOpen);

    if (nextOpen && !loaded) {
      void reloadAssets();
    }
  }

  async function selectAsset(asset: Asset) {
    setSelected(asset);
    setVariants([]);
    setAltText(defaultAltText(asset.originalFileName));
    setCaption('');
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

  function insert() {
    if (!selected || !altText.trim()) return;

    onInsert(createAssetMarkdownReference(selected.id, altText, caption));
    setOpen(false);
    setSelected(undefined);
    setVariants([]);
    setAltText('');
    setCaption('');
  }

  return (
    <div className={styles.assetPicker}>
      <button className={styles.secondary} disabled={disabled} type="button" onClick={togglePicker}>
        {open ? 'Asset Picker 닫기' : 'Asset 삽입'}
      </button>

      {open ? (
        <div className={styles.assetPickerPanel}>
          <div className={styles.assetPickerHeader}>
            <div>
              <strong>READY Asset</strong>
              <p>Private 원본이 아닌 Public Variant를 확인하고 Reference를 삽입합니다.</p>
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
                <p className={styles.muted}>Asset을 불러오는 중입니다…</p>
              ) : null}
              {!loading && assets.length === 0 ? (
                <p className={styles.muted}>삽입할 수 있는 READY Asset이 없습니다.</p>
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
                      maxLength={500}
                      placeholder="이미지를 설명하는 대체 텍스트"
                      value={altText}
                      onChange={(event) => setAltText(event.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Caption</span>
                    <input
                      maxLength={500}
                      placeholder="선택 사항"
                      value={caption}
                      onChange={(event) => setCaption(event.target.value)}
                    />
                  </label>
                  <button
                    className={styles.button}
                    disabled={!altText.trim() || variants.length === 0 || loading}
                    type="button"
                    onClick={insert}
                  >
                    Markdown에 삽입
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

export function createAssetMarkdownReference(
  assetId: string,
  altText: string,
  caption?: string,
): string {
  const normalizedAlt = escapeMarkdownAltText(altText.trim());
  const normalizedCaption = escapeMarkdownTitle(caption?.trim() ?? '');

  if (!assetId || !normalizedAlt) {
    throw new Error('Asset ID and Alt Text are required.');
  }

  return `![${normalizedAlt}](asset://${assetId}${normalizedCaption ? ` "${normalizedCaption}"` : ''})`;
}

function escapeMarkdownAltText(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/\[/gu, '\\[').replace(/\]/gu, '\\]');
}

function escapeMarkdownTitle(value: string): string {
  return value.replace(/\s+/gu, ' ').replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
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

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : 'Asset을 불러오지 못했습니다.';
}
