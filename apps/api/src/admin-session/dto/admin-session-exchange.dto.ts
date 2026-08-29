import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length } from 'class-validator';

export class AdminSessionExchangeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  public grantId!: string;

  @ApiProperty({
    description:
      'Short-lived authentication grant returned after MFA verification.',
  })
  @IsString()
  @Length(64, 512)
  public grantToken!: string;
}
