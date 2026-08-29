import { Injectable } from '@nestjs/common';

import { ActorType, createUuidV7, requestContext } from '@atlas/server';

type HeaderValue = string | string[] | undefined;
type NextFunction = (error?: unknown) => void;

interface RequestLike {
  headers: Record<string, HeaderValue>;
}

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

const CONTEXT_HEADER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

@Injectable()
export class RequestContextMiddleware {
  public use(request: RequestLike, response: ResponseLike, next: NextFunction): void {
    const requestId = readContextHeader(request, 'x-request-id') ?? createUuidV7();
    const traceId = readContextHeader(request, 'x-trace-id') ?? requestId;
    const correlationId = readContextHeader(request, 'x-correlation-id') ?? traceId;

    response.setHeader('x-request-id', requestId);
    response.setHeader('x-trace-id', traceId);

    requestContext.run(
      {
        requestId,
        traceId,
        correlationId,
        actorType: ActorType.ANONYMOUS,
      },
      () => next(),
    );
  }
}

function readContextHeader(request: RequestLike, name: string): string | undefined {
  const header = request.headers[name];
  const value = Array.isArray(header) ? header[0] : header;

  if (!value || !CONTEXT_HEADER_PATTERN.test(value)) {
    return undefined;
  }

  return value;
}
