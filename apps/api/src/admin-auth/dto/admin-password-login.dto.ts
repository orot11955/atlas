import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class AdminPasswordLoginDto {
  @ApiProperty({ format: 'email', maxLength: 320 })
  @IsEmail()
  @MaxLength(320)
  public email!: string;

  @ApiProperty({ writeOnly: true, minLength: 1, maxLength: 1_024 })
  @IsString()
  @MinLength(1)
  @MaxLength(1_024)
  public password!: string;
}
