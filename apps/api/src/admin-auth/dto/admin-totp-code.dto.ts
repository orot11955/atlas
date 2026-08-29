import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

import { AdminMfaChallengeDto } from './admin-mfa-challenge.dto';

export class AdminTotpCodeDto extends AdminMfaChallengeDto {
  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @IsString()
  @Matches(/^\d{6}$/u)
  public code!: string;
}
