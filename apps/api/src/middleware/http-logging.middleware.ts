import { Inject, Injectable } from '@nestjs/common';

import {
  ATLAS_LOGGER,
  AtlasLogLevel,
  type AtlasLogger,
} from '@atlas/server';

type NextFunction = (error?: unknown) => void;

interface RequestLike {
  method: string;
  originalUrl?: string;
  url?: string;
}

interface ResponseLike {
  statusCode: number;
  once(event: 'finish' | 'close', listener: () => void): void;
}

@Injectable()
export class HttpLoggingMiddleware {
  public constructor(@Inject(ATLAS_LOGGER) private readonly logger: AtlasLogger) {}

  public use(request: RequestLike, response: ResponseLike, next: NextFunction): void {
    const method = request.method.toUpperCase();
    const path = getPath(request.originalUrl ?? request.url ?? '/');
    const startedAt = process.hrtime.bigint();
    let completed = false;

    this.logger.write(
      AtlasLogLevel.DEBUG,
      {
        event: 'http.request.started',
        method,
        path,
      },
      'HTTP request started.',
    );

    const complete = (termination: 'finish' | 'close'): void => {
      if (completed) {
        return;
      }

      completed = true;
      const statusCode = response.statusCode;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const level =
        statusCode >= 500
          ? AtlasLogLevel.ERROR
          : statusCode >= 400
            ? AtlasLogLevel.WARN
            : AtlasLogLevel.INFO;

      this.logger.write(
        level,
        {
          event: 'http.request.completed',
          method,
          path,
          statusCode,
          durationMs: Math.round(durationMs * 1_000) / 1_000,
          termination,
        },
        'HTTP request completed.',
      );
    };

    response.once('finish', () => complete('finish'));
    response.once('close', () => complete('close'));
    next();
  }
}

function getPath(url: string): string {
  const queryIndex = url.indexOf('?');
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}
