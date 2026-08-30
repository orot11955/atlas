import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  createApiClientAuthenticationError,
  type ApiClientAuthenticationService,
  type ApiClientScope,
  type ApiClientType,
} from '@atlas/server';

import {
  readSingleApiClientHeader,
  type ApiClientHttpRequest,
} from './api-client.request';
import { API_CLIENT_AUTHENTICATION_SERVICE } from './api-client.tokens';

const API_CLIENT_REQUIREMENT_METADATA = 'atlas:api-client-requirement';

export interface ApiClientAccessRequirement {
  scope: ApiClientScope;
  type?: ApiClientType;
  siteParam?: string;
}

export const RequireApiClientAccess = (
  requirement: ApiClientAccessRequirement,
): MethodDecorator & ClassDecorator =>
  SetMetadata(API_CLIENT_REQUIREMENT_METADATA, Object.freeze({ ...requirement }));

@Injectable()
export class ApiClientAuthenticationGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    @Inject(API_CLIENT_AUTHENTICATION_SERVICE)
    private readonly authenticationService: ApiClientAuthenticationService<unknown>,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<
      ApiClientAccessRequirement | undefined
    >(API_CLIENT_REQUIREMENT_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requirement) {
      return true;
    }

    const request = context.switchToHttp().getRequest<ApiClientHttpRequest>();
    const apiKey = readBearerToken(
      readSingleApiClientHeader(request.headers.authorization),
    );
    const siteKey = request.params?.[requirement.siteParam ?? 'siteKey'];

    if (!apiKey || !siteKey) {
      throw createApiClientAuthenticationError();
    }

    const principal = await this.authenticationService.authenticate({
      apiKey,
      requiredScope: requirement.scope,
      requiredType: requirement.type,
      siteKey,
      origin: readSingleApiClientHeader(request.headers.origin),
    });

    request.apiClient = principal;
    this.authenticationService.enterRequestContext(principal);
    return true;
  }
}

export function requireApiClientPrincipal(
  request: ApiClientHttpRequest,
) {
  if (!request.apiClient) {
    throw createApiClientAuthenticationError();
  }

  return request.apiClient;
}

function readBearerToken(value?: string): string | undefined {
  if (!value || value.length > 768) {
    return undefined;
  }

  const match = /^Bearer[ \t]+([^\s]+)$/iu.exec(value.trim());
  return match?.[1];
}
