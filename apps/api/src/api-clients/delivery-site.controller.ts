import { Controller, Get, Header, Param, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';

import { ApiClientScope, ApiClientType, createApiClientAuthenticationError } from '@atlas/server';

import {
  ApiClientAuthenticationGuard,
  RequireApiClientAccess,
  requireApiClientPrincipal,
} from './api-client-auth.guard';
import type { ApiClientHttpRequest } from './api-client.request';

@ApiTags('Delivery Sites')
@Controller('delivery/v1/sites')
export class DeliverySiteController {
  @Get(':siteKey')
  @UseGuards(ApiClientAuthenticationGuard)
  @RequireApiClientAccess({
    scope: ApiClientScope.SITE_READ,
    type: ApiClientType.DELIVERY,
    siteParam: 'siteKey',
  })
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Authorization, Origin')
  @ApiOkResponse({ description: 'Returns public-safe Site delivery metadata.' })
  @ApiUnauthorizedResponse({ description: 'A valid Delivery API Key is required.' })
  public getSite(@Req() request: ApiClientHttpRequest, @Param('siteKey') _siteKey: string) {
    const site = requireApiClientPrincipal(request).site;

    if (!site) {
      throw createApiClientAuthenticationError();
    }

    return {
      data: {
        key: site.key,
        name: site.name,
        type: site.type,
        timezone: site.timezone,
        locale: site.locale,
        ...(site.canonicalHostname ? { canonicalDomain: site.canonicalHostname } : {}),
      },
    };
  }
}
