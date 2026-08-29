import type { ErrorCode } from './error-code';

export type ErrorDetails = Readonly<Record<string, unknown>>;

export interface ApplicationErrorOptions {
  code: ErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class ApplicationError extends Error {
  public readonly code: string;
  public readonly details?: ErrorDetails;

  public constructor(options: ApplicationErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });

    this.name = new.target.name;
    this.code = options.code;
    this.details = options.details ? Object.freeze({ ...options.details }) : undefined;
  }
}

export class DomainError extends ApplicationError {}

export function isApplicationError(error: unknown): error is ApplicationError {
  return error instanceof ApplicationError;
}
