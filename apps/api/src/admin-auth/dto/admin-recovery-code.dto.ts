import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

import { AdminMfaChallengeDto } from './admin-mfa-challenge.dto';

export class AdminRecoveryCodeDto extends AdminMfaChallengeDto {
  @ApiProperty({ example: 'ABCD-EFGH-IJKL-MNOP' })
  @IsString()
  @Length(16, 32)
  @Matches(/^[A-Za-z2-9\s-]+$/u)
  public recoveryCode!: string;
}
