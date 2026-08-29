import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import type {
  AdminSessionListItem,
  AdminSessionPrincipal,
  AdminSessionService,
} from '@atlas/server';

import { resolveClientAddress } from '../admin-auth/client-address';
import { AdminCsrfGuard } from './admin-csrf.guard';
import {
  createClearCsrfCookieOptions,
  createClearSessionCookieOptions,
  createCsrfCookieOptions,
  createSessionCookieOptions,
  type AdminCookieOptions,
  type AdminSessionCookieConfiguration,
} from './admin-session.cookies';
import { AdminSessionGuard, requireAdminSessionPrincipal } from './admin-session.guard';
import { readSingleHeader, type AdminSessionHttpRequest } from './admin-session.request';
import { ADMIN_SESSION_COOKIE_CONFIGURATION, ADMIN_SESSION_SERVICE } from './admin-session.tokens';
import { AdminSessionExchangeDto } from './dto/admin-session-exchange.dto';

interface CookieResponse {
  cookie(name: string, value: string, options: AdminCookieOptions): void;
  clearCookie(name: string, options: AdminCookieOptions): void;
}

interface AdminSessionData {
  id: string;
  role: AdminSessionPrincipal['role'];
  userAgentSummary: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

@ApiTags('Admin Auth')
@Controller('admin/v1/auth')
export class AdminSessionController {
  public constructor(
    @Inject(ADMIN_SESSION_SERVICE)
    private readonly sessionService: AdminSessionService<unknown>,
    @Inject(ADMIN_SESSION_COOKIE_CONFIGURATION)
    private readonly cookies: AdminSessionCookieConfiguration,
  ) {}

  @Post('session')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiCreatedResponse({
    description: 'The authentication grant was consumed and an administrator session was created.',
  })
  @ApiUnauthorizedResponse({
    description: 'The authentication grant is invalid or expired.',
  })
  public async createSession(
    @Body() body: AdminSessionExchangeDto,
    @Req() request: AdminSessionHttpRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<{ data: AdminSessionData }> {
    const result = await this.sessionService.createSession({
      grantId: body.grantId,
      grantToken: body.grantToken,
      clientAddress: resolveClientAddress(request),
      userAgent: readSingleHeader(request.headers['user-agent']),
    });

    response.cookie(
      this.cookies.sessionCookieName,
      result.sessionToken,
      createSessionCookieOptions(
        this.cookies,
        result.session.absoluteExpiresAt,
        result.session.createdAt,
      ),
    );
    response.cookie(
      this.cookies.csrfCookieName,
      result.csrfToken,
      createCsrfCookieOptions(
        this.cookies,
        result.session.absoluteExpiresAt,
        result.session.createdAt,
      ),
    );

    return { data: toSessionData(result.session) };
  }

  @Get('session')
  @UseGuards(AdminSessionGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    description: 'Returns the current administrator session.',
  })
  @ApiUnauthorizedResponse({
    description: 'An administrator session is required.',
  })
  public currentSession(@Req() request: AdminSessionHttpRequest): { data: AdminSessionData } {
    return { data: toSessionData(requireAdminSessionPrincipal(request)) };
  }

  @Post('logout')
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @ApiNoContentResponse({
    description: 'The current administrator session was revoked.',
  })
  public async logout(
    @Req() request: AdminSessionHttpRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<void> {
    await this.sessionService.logout(requireAdminSessionPrincipal(request));
    this.clearCookies(response);
  }

  @Get('sessions')
  @UseGuards(AdminSessionGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    description: 'Returns recent sessions for the current administrator.',
  })
  public async listSessions(
    @Req() request: AdminSessionHttpRequest,
  ): Promise<{ data: readonly ReturnType<typeof toSessionListData>[] }> {
    const sessions = await this.sessionService.listSessions(requireAdminSessionPrincipal(request));

    return { data: sessions.map(toSessionListData) };
  }

  @Post('sessions/revoke-others')
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    description: 'Revokes every other session for the current administrator.',
  })
  public async revokeOtherSessions(
    @Req() request: AdminSessionHttpRequest,
  ): Promise<{ data: { revokedCount: number } }> {
    const revokedCount = await this.sessionService.revokeOtherSessions(
      requireAdminSessionPrincipal(request),
    );

    return { data: { revokedCount } };
  }

  @Post('sessions/:sessionId/revoke')
  @UseGuards(AdminSessionGuard, AdminCsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @ApiNoContentResponse({
    description: 'The selected administrator session was revoked.',
  })
  public async revokeSession(
    @Req() request: AdminSessionHttpRequest,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
  ): Promise<void> {
    await this.sessionService.revokeSession(requireAdminSessionPrincipal(request), sessionId);
  }

  private clearCookies(response: CookieResponse): void {
    response.clearCookie(
      this.cookies.sessionCookieName,
      createClearSessionCookieOptions(this.cookies),
    );
    response.clearCookie(this.cookies.csrfCookieName, createClearCsrfCookieOptions(this.cookies));
  }
}

function toSessionData(session: Readonly<AdminSessionPrincipal>): AdminSessionData {
  return {
    id: session.sessionId,
    role: session.role,
    userAgentSummary: session.userAgentSummary,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    idleExpiresAt: session.idleExpiresAt.toISOString(),
    absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
  };
}

function toSessionListData(session: Readonly<AdminSessionListItem>) {
  return {
    id: session.id,
    current: session.current,
    status: session.status,
    userAgentSummary: session.userAgentSummary,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    idleExpiresAt: session.idleExpiresAt.toISOString(),
    absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
    ...(session.revokedAt ? { revokedAt: session.revokedAt.toISOString() } : {}),
    ...(session.revokeReason ? { revokeReason: session.revokeReason } : {}),
  };
}
