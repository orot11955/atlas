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
