import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length } from 'class-validator';

export class AdminMfaChallengeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  public challengeId!: string;

  @ApiProperty({
    description: 'Short-lived challenge token returned by the password login endpoint.',
  })
  @IsString()
  @Length(64, 512)
  public challengeToken!: string;
}
