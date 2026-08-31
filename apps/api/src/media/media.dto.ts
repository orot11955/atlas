import { IsIn, IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';

import { ASSET_IMAGE_CONTENT_TYPES, type AssetImageContentType } from '@atlas/server';

export class AssetListQueryDto {
  @IsString()
  @Matches(/^(?:[1-9]|[1-9][0-9]|100)$/u)
  public limit?: string;
}

export class CreateAssetUploadSessionDto {
  @IsString()
  @Length(1, 255)
  public fileName!: string;

  @IsString()
  @IsIn(ASSET_IMAGE_CONTENT_TYPES)
  public contentType!: AssetImageContentType;

  @IsInt()
  @Min(1)
  @Max(26_214_400)
  public size!: number;

  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/u)
  public sha256!: string;
}
