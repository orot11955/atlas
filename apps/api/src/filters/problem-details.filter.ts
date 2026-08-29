import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';

import {
  ErrorCode,
  createUuidV7,
  isApplicationError,
  requestContext,
  systemClock,
} from '@atlas/server';

interface HttpResponseLike {
  status(statusCode: number): HttpResponseLike;
  type(contentType: string): HttpResponseLike;
  send(body: unknown): void;
}

interface NormalizedProblem {
  status: number;
  title: string;
  code: string;
  detail: string;
  details?: Readonly<Record<string, unknown>>;
  errors?: readonly string[];
}

const APPLICATION_ERROR_STATUS: Readonly<Record<string, number>> = {
  [ErrorCode.ACTION_NOT_ALLOWED]: HttpStatus.FORBIDDEN,
  [ErrorCode.AUTH_REQUIRED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ErrorCode.INTERNAL_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
  [ErrorCode.INVALID_STATE_TRANSITION]: HttpStatus.CONFLICT,
  [ErrorCode.MFA_REQUIRED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
  [ErrorCode.REAUTH_REQUIRED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.REQUEST_CONTEXT_REQUIRED]: HttpStatus.INTERNAL_SERVER_ERROR,
  [ErrorCode.VALIDATION_FAILED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.VERSION_CONFLICT]: HttpStatus.CONFLICT,
};

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponseLike>();
    const problem = normalizeException(exception);
    const requestId = requestContext.get()?.requestId ?? createUuidV7();

    if (problem.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(`Unhandled request error (${requestId}).`, stack);
    }

    response
      .status(problem.status)
      .type('application/problem+json')
      .send({
        type: 'about:blank',
        title: problem.title,
        status: problem.status,
        code: problem.code,
        detail: problem.detail,
        requestId,
        timestamp: systemClock.now().toISOString(),
        ...(problem.details ? { details: problem.details } : {}),
        ...(problem.errors ? { errors: problem.errors } : {}),
      });
  }
}

function normalizeException(exception: unknown): NormalizedProblem {
  if (isApplicationError(exception)) {
    const status = APPLICATION_ERROR_STATUS[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;

    return {
      status,
      title: exception.name,
      code: exception.code,
      detail:
        status >= HttpStatus.INTERNAL_SERVER_ERROR
          ? 'An unexpected error occurred.'
          : exception.message,
      details: status < HttpStatus.INTERNAL_SERVER_ERROR ? exception.details : undefined,
    };
  }

  if (exception instanceof HttpException) {
    return normalizeHttpException(exception);
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    title: 'Internal Server Error',
    code: ErrorCode.INTERNAL_ERROR,
    detail: 'An unexpected error occurred.',
  };
}

function normalizeHttpException(exception: HttpException): NormalizedProblem {
  const status = exception.getStatus();
  const body = exception.getResponse();
  const bodyRecord = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const messages = bodyRecord.message;
  const errors = Array.isArray(messages)
    ? messages.filter((message): message is string => typeof message === 'string')
    : undefined;
  const detail =
    status >= HttpStatus.INTERNAL_SERVER_ERROR
      ? 'An unexpected error occurred.'
      : typeof messages === 'string'
        ? messages
        : typeof body === 'string'
          ? body
          : exception.message;

  return {
    status,
    title: typeof bodyRecord.error === 'string' ? bodyRecord.error : exception.name,
    code: httpStatusToErrorCode(status),
    detail,
    errors: errors && errors.length > 0 ? errors : undefined,
  };
}

function httpStatusToErrorCode(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ErrorCode.VALIDATION_FAILED;
    case HttpStatus.UNAUTHORIZED:
      return ErrorCode.AUTH_REQUIRED;
    case HttpStatus.FORBIDDEN:
      return ErrorCode.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ErrorCode.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ErrorCode.VERSION_CONFLICT;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ErrorCode.RATE_LIMITED;
    default:
      return status >= HttpStatus.INTERNAL_SERVER_ERROR
        ? ErrorCode.INTERNAL_ERROR
        : `HTTP_${status}`;
  }
}
