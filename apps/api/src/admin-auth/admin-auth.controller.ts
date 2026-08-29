import { Body, Controller, Header, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import type { AdminPasswordLoginService } from '@atlas/server';

import { ADMIN_PASSWORD_LOGIN_SERVICE } from './admin-auth.tokens';
import { resolveClientAddress, type ClientRequest } from './client-address';
import { AdminPasswordLoginDto } from './dto/admin-password-login.dto';

interface AdminPasswordLoginResponse {
  data: {
    challengeId: string;
    challengeToken: string;
    expiresAt: string;
    nextStep: 'mfa' | 'mfa-setup';
  };
}

@ApiTags('Admin Auth')
@Controller('admin/v1/auth')
export class AdminAuthController {
  public constructor(
    @Inject(ADMIN_PASSWORD_LOGIN_SERVICE)
    private readonly passwordLoginService: AdminPasswordLoginService<unknown>,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiBody({ type: AdminPasswordLoginDto })
  @ApiAcceptedResponse({
    description: 'Password verified and an MFA challenge was issued.',
  })
  @ApiUnauthorizedResponse({ description: 'Email or password is invalid.' })
  @ApiTooManyRequestsResponse({ description: 'The Redis login rate limit is active.' })
  public async login(
    @Body() body: AdminPasswordLoginDto,
    @Req() request: ClientRequest,
  ): Promise<AdminPasswordLoginResponse> {
    const result = await this.passwordLoginService.execute({
      email: body.email,
      password: body.password,
      clientAddress: resolveClientAddress(request),
    });

    return {
      data: {
        challengeId: result.challengeId,
        challengeToken: result.challengeToken,
        expiresAt: result.expiresAt.toISOString(),
        nextStep: result.nextStep,
      },
    };
  }
}
