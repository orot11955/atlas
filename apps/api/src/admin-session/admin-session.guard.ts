import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';

import {
  DomainError,
  ErrorCode,
  type AdminSessionPrincipal,
  type AdminSessionService,
} from '@atlas/server';

import { resolveClientAddress } from '../admin-auth/client-address';
import {
  readRequestCookie,
  type AdminSessionCookieConfiguration,
} from './admin-session.cookies';
import type { AdminSessionHttpRequest } from './admin-session.request';
import {
  ADMIN_SESSION_COOKIE_CONFIGURATION,
  ADMIN_SESSION_SERVICE,
} from './admin-session.tokens';

@Injectable()
export class AdminSessionGuard implements CanActivate {
  public constructor(
    @Inject(ADMIN_SESSION_SERVICE)
    private readonly sessionService: AdminSessionService<unknown>,
    @Inject(ADMIN_SESSION_COOKIE_CONFIGURATION)
    private readonly cookies: AdminSessionCookieConfiguration,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AdminSessionHttpRequest>();
    const sessionToken = readRequestCookie(
      request.headers.cookie,
      this.cookies.sessionCookieName,
    );

    if (!sessionToken) {
      throw createAuthenticationRequiredError();
    }

    const principal = await this.sessionService.authenticateSession({
      sessionToken,
      clientAddress: resolveClientAddress(request),
    });

    request.adminSession = principal;
    this.sessionService.enterRequestContext(principal);
    return true;
  }
}

export function requireAdminSessionPrincipal(
  request: AdminSessionHttpRequest,
): Readonly<AdminSessionPrincipal> {
  if (!request.adminSession) {
    throw createAuthenticationRequiredError();
  }

  return request.adminSession;
}

function createAuthenticationRequiredError(): DomainError {
  return new DomainError({
    code: ErrorCode.AUTH_REQUIRED,
    message: 'A valid administrator session is required.',
  });
}
