import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsLocale, IsString, Length, Max, Min } from 'class-validator';

export class UpdateWorkspaceDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  public version!: number;

  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString()
  @Length(1, 120)
  public name!: string;

  @ApiProperty({ example: 'Asia/Seoul' })
  @IsString()
  @Length(1, 64)
  public timezone!: string;

  @ApiProperty({ example: 'ko-KR' })
  @IsLocale()
  public locale!: string;
}
