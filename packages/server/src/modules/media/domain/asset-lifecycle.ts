import type { AssetUsageKind } from '../../content/domain/content-asset';

export interface AssetUsageViewRecord {
  id: string;
  workspaceId: string;
  assetId: string;
  contentId: string;
  revisionId: string;
  revisionNumber: number;
  contentTitle: string;
  kind: AssetUsageKind;
  ordinal: number;
  altText: string;
  caption?: string;
  activePublicationCount: number;
  createdAt: Date;
}
