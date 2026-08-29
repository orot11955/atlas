import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';

import type { AdminSessionService } from '@atlas/server';

import { readRequestCookie, type AdminSessionCookieConfiguration } from './admin-session.cookies';
import { requireAdminSessionPrincipal } from './admin-session.guard';
import { readSingleHeader, type AdminSessionHttpRequest } from './admin-session.request';
import { ADMIN_SESSION_COOKIE_CONFIGURATION, ADMIN_SESSION_SERVICE } from './admin-session.tokens';

@Injectable()
export class AdminCsrfGuard implements CanActivate {
  public constructor(
    @Inject(ADMIN_SESSION_SERVICE)
    private readonly sessionService: AdminSessionService<unknown>,
    @Inject(ADMIN_SESSION_COOKIE_CONFIGURATION)
    private readonly cookies: AdminSessionCookieConfiguration,
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AdminSessionHttpRequest>();
    const principal = requireAdminSessionPrincipal(request);
    const cookieToken = readRequestCookie(request.headers.cookie, this.cookies.csrfCookieName);
    const headerToken = readSingleHeader(request.headers['x-csrf-token']);

    this.sessionService.assertCsrf(principal, cookieToken, headerToken);
    return true;
  }
}
