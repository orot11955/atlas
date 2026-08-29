import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import type { AdminMfaService } from '@atlas/server';

import { ADMIN_MFA_SERVICE } from './admin-auth.tokens';
import { resolveClientAddress, type ClientRequest } from './client-address';
import { AdminMfaChallengeDto } from './dto/admin-mfa-challenge.dto';
import { AdminRecoveryCodeDto } from './dto/admin-recovery-code.dto';
import { AdminTotpCodeDto } from './dto/admin-totp-code.dto';

interface AdminTotpEnrollmentResponse {
  data: {
    methodId: string;
    secret: string;
    provisioningUri: string;
    algorithm: 'SHA1';
    digits: 6;
    period: 30;
  };
}

interface AdminAuthenticationGrantResponse {
  data: {
    grantId: string;
    grantToken: string;
    expiresAt: string;
    nextStep: 'session';
  };
}

interface AdminTotpEnrollmentConfirmationResponse {
  data: AdminAuthenticationGrantResponse['data'] & {
    recoveryCodes: readonly string[];
  };
}

@ApiTags('Admin Auth')
@Controller('admin/v1/auth/mfa')
export class AdminMfaController {
  public constructor(
    @Inject(ADMIN_MFA_SERVICE)
    private readonly mfaService: AdminMfaService<unknown>,
  ) {}

  @Post('totp/enrollment')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiOkResponse({ description: 'Returns or resumes a pending TOTP enrollment.' })
  @ApiUnauthorizedResponse({ description: 'The login challenge is invalid or expired.' })
  @ApiConflictResponse({ description: 'TOTP is already active or must be reset.' })
  public async startTotpEnrollment(
    @Body() body: AdminMfaChallengeDto,
    @Req() request: ClientRequest,
  ): Promise<AdminTotpEnrollmentResponse> {
    const result = await this.mfaService.startTotpEnrollment({
      challengeId: body.challengeId,
      challengeToken: body.challengeToken,
      clientAddress: resolveClientAddress(request),
    });

    return {
      data: {
        methodId: result.methodId,
        secret: result.secret,
        provisioningUri: result.provisioningUri,
        algorithm: result.algorithm,
        digits: result.digits,
        period: result.period,
      },
    };
  }

  @Post('totp/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiAcceptedResponse({
    description: 'Activates TOTP and returns one-time recovery codes and a session grant.',
  })
  @ApiUnauthorizedResponse({ description: 'TOTP verification failed.' })
  @ApiConflictResponse({ description: 'A pending TOTP enrollment is required.' })
  public async confirmTotpEnrollment(
    @Body() body: AdminTotpCodeDto,
    @Req() request: ClientRequest,
  ): Promise<AdminTotpEnrollmentConfirmationResponse> {
    const result = await this.mfaService.confirmTotpEnrollment({
      challengeId: body.challengeId,
      challengeToken: body.challengeToken,
      code: body.code,
      clientAddress: resolveClientAddress(request),
    });

    return {
      data: {
        grantId: result.grantId,
        grantToken: result.grantToken,
        expiresAt: result.expiresAt.toISOString(),
        nextStep: result.nextStep,
        recoveryCodes: result.recoveryCodes,
      },
    };
  }

  @Post('totp/verify')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiAcceptedResponse({ description: 'Verifies TOTP and returns a session grant.' })
  @ApiUnauthorizedResponse({ description: 'TOTP verification failed.' })
  public async verifyTotp(
    @Body() body: AdminTotpCodeDto,
    @Req() request: ClientRequest,
  ): Promise<AdminAuthenticationGrantResponse> {
    const result = await this.mfaService.verifyTotp({
      challengeId: body.challengeId,
      challengeToken: body.challengeToken,
      code: body.code,
      clientAddress: resolveClientAddress(request),
    });

    return {
      data: {
        grantId: result.grantId,
        grantToken: result.grantToken,
        expiresAt: result.expiresAt.toISOString(),
        nextStep: result.nextStep,
      },
    };
  }

  @Post('recovery/verify')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiAcceptedResponse({
    description: 'Consumes a recovery code and returns a session grant.',
  })
  @ApiUnauthorizedResponse({ description: 'Recovery code verification failed.' })
  public async verifyRecoveryCode(
    @Body() body: AdminRecoveryCodeDto,
    @Req() request: ClientRequest,
  ): Promise<AdminAuthenticationGrantResponse> {
    const result = await this.mfaService.verifyRecoveryCode({
      challengeId: body.challengeId,
      challengeToken: body.challengeToken,
      recoveryCode: body.recoveryCode,
      clientAddress: resolveClientAddress(request),
    });

    return {
      data: {
        grantId: result.grantId,
        grantToken: result.grantToken,
        expiresAt: result.expiresAt.toISOString(),
        nextStep: result.nextStep,
      },
    };
  }
}
