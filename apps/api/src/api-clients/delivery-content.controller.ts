import { Controller, Get, Header, Inject, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import {
  ApiClientScope,
  ApiClientType,
  ContentType,
  createApiClientAuthenticationError,
  type ContentDeliveryService,
} from '@atlas/server';

import {
  ApiClientAuthenticationGuard,
  RequireApiClientAccess,
  requireApiClientPrincipal,
} from './api-client-auth.guard';
import { readSingleApiClientHeader, type ApiClientHttpRequest } from './api-client.request';
import { DeliveryContentListQueryDto } from '../content/content-publication.dto';
import {
  toDeliveryContentData,
  toDeliveryContentSummaryData,
} from '../content/content-publication.presenter';
import { CONTENT_DELIVERY_SERVICE } from '../content/content.tokens';

interface PassthroughResponse {
  setHeader(name: string, value: string): void;
  status(statusCode: number): unknown;
}

const CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';

@ApiTags('Delivery Content')
@Controller('delivery/v1/sites')
@UseGuards(ApiClientAuthenticationGuard)
export class DeliveryContentController {
  public constructor(
    @Inject(CONTENT_DELIVERY_SERVICE)
    private readonly deliveryService: ContentDeliveryService<unknown>,
  ) {}

  @Get(':siteKey/contents')
  @RequireApiClientAccess({
    scope: ApiClientScope.CONTENT_READ,
    type: ApiClientType.DELIVERY,
    siteParam: 'siteKey',
  })
  @Header('Cache-Control', CACHE_CONTROL)
  @Header('Vary', 'Authorization, Origin')
  @ApiOkResponse({ description: 'Returns active public Content Publication summaries.' })
  public listContents(
    @Req() request: ApiClientHttpRequest,
    @Query() query: DeliveryContentListQueryDto,
  ) {
    return this.list(request, query);
  }

  @Get(':siteKey/posts')
  @RequireApiClientAccess({
    scope: ApiClientScope.CONTENT_READ,
    type: ApiClientType.DELIVERY,
    siteParam: 'siteKey',
  })
  @Header('Cache-Control', CACHE_CONTROL)
  @Header('Vary', 'Authorization, Origin')
  @ApiOkResponse({ description: 'Returns active public Post Publication summaries.' })
  public listPosts(
    @Req() request: ApiClientHttpRequest,
    @Query() query: DeliveryContentListQueryDto,
  ) {
    return this.list(request, query, ContentType.POST);
  }

  @Get(':siteKey/contents/:slug')
  @RequireApiClientAccess({
    scope: ApiClientScope.CONTENT_READ,
    type: ApiClientType.DELIVERY,
    siteParam: 'siteKey',
  })
  @Header('Cache-Control', CACHE_CONTROL)
  @Header('Vary', 'Authorization, Origin')
  @ApiOkResponse({ description: 'Returns one active public or unlisted Publication Snapshot.' })
  @ApiNotFoundResponse({ description: 'Published Content was not found.' })
  public getContent(
    @Req() request: ApiClientHttpRequest,
    @Res({ passthrough: true }) response: PassthroughResponse,
    @Param('slug') slug: string,
  ) {
    return this.get(request, response, slug);
  }

  @Get(':siteKey/posts/:slug')
  @RequireApiClientAccess({
    scope: ApiClientScope.CONTENT_READ,
    type: ApiClientType.DELIVERY,
    siteParam: 'siteKey',
  })
  @Header('Cache-Control', CACHE_CONTROL)
  @Header('Vary', 'Authorization, Origin')
  @ApiOkResponse({ description: 'Returns one active public or unlisted Post Snapshot.' })
  @ApiNotFoundResponse({ description: 'Published Post was not found.' })
  public getPost(
    @Req() request: ApiClientHttpRequest,
    @Res({ passthrough: true }) response: PassthroughResponse,
    @Param('slug') slug: string,
  ) {
    return this.get(request, response, slug, ContentType.POST);
  }

  private async list(
    request: ApiClientHttpRequest,
    query: DeliveryContentListQueryDto,
    forcedType?: ContentType,
  ) {
    const principal = requireApiClientPrincipal(request);
    const site = principal.site;

    if (!site) {
      throw createApiClientAuthenticationError();
    }

    const result = await this.deliveryService.list(principal.workspaceId, site.id, {
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
      contentType: forcedType ?? query.type,
    });

    return {
      data: {
        items: result.items.map(toDeliveryContentSummaryData),
        pageInfo: {
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        },
      },
    };
  }

  private async get(
    request: ApiClientHttpRequest,
    response: PassthroughResponse,
    slug: string,
    contentType?: ContentType,
  ) {
    const principal = requireApiClientPrincipal(request);
    const site = principal.site;

    if (!site) {
      throw createApiClientAuthenticationError();
    }

    const content = await this.deliveryService.getBySlug(
      principal.workspaceId,
      site.id,
      slug,
      contentType,
    );
    const etag = `"${content.etag}"`;
    response.setHeader('ETag', etag);

    if (matchesIfNoneMatch(readSingleApiClientHeader(request.headers['if-none-match']), etag)) {
      response.status(304);
      return undefined;
    }

    return { data: toDeliveryContentData(content) };
  }
}

function matchesIfNoneMatch(value: string | undefined, etag: string): boolean {
  if (!value) {
    return false;
  }

  return value.split(',').some((candidate) => {
    const normalized = candidate.trim();
    return normalized === '*' || normalized === etag || normalized === `W/${etag}`;
  });
}
