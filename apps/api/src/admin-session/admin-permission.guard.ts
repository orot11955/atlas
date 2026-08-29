import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { hasAdminPermission, type AdminPermission } from '@atlas/server';

import { requireAdminSessionPrincipal } from './admin-session.guard';
import type { AdminSessionHttpRequest } from './admin-session.request';

const ADMIN_PERMISSION_METADATA = 'atlas:admin-permission';

export const RequireAdminPermission = (
  permission: AdminPermission,
): MethodDecorator & ClassDecorator => SetMetadata(ADMIN_PERMISSION_METADATA, permission);

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<AdminPermission | undefined>(
      ADMIN_PERMISSION_METADATA,
      [context.getHandler(), context.getClass()],
    );

    if (!permission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AdminSessionHttpRequest>();
    const principal = requireAdminSessionPrincipal(request);

    if (!hasAdminPermission(principal.role, permission)) {
      throw new ForbiddenException('Administrator permission is required.');
    }

    return true;
  }
}
