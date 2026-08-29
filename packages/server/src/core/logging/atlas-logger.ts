import pino, { type DestinationStream, type Logger as PinoLogger, type LoggerOptions } from 'pino';

import { requestContext } from '../request-context';
import { REDACTED_LOG_VALUE, redactLogBindings, redactLogMessage } from './log-redaction';

export const ATLAS_LOGGER = Symbol.for('@atlas/server/logger');

export const AtlasLogLevel = {
  DEBUG: 'debug',
  ERROR: 'error',
  FATAL: 'fatal',
  INFO: 'info',
  TRACE: 'trace',
  WARN: 'warn',
} as const;

export type AtlasLogLevel = (typeof AtlasLogLevel)[keyof typeof AtlasLogLevel];

export interface AtlasLoggerOptions {
  service: string;
  environment: string;
  level: AtlasLogLevel;
  version?: string;
}

export type AtlasLogBindings = Readonly<Record<string, unknown>>;

const PINO_REDACT_PATHS = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'secret',
  '*.secret',
  'token',
  '*.token',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
  'res.headers.set-cookie',
  'response.headers.set-cookie',
];

export class AtlasLogger {
  public constructor(private readonly logger: PinoLogger) {}

  public child(bindings: AtlasLogBindings): AtlasLogger {
    return new AtlasLogger(this.logger.child(redactLogBindings(bindings)));
  }

  public write(
    level: AtlasLogLevel,
    bindings: AtlasLogBindings,
    message: string,
    error?: Error,
  ): void {
    const payload: Record<string, unknown> = {
      ...redactLogBindings(bindings),
      ...currentContextBindings(),
    };

    if (error) {
      payload.err = createSafeError(error);
    }

    this.emit(level, payload, redactLogMessage(message));
  }

  public log(message: unknown, ...optionalParams: unknown[]): void {
    this.writeNestLog(AtlasLogLevel.INFO, message, optionalParams);
  }

  public error(message: unknown, ...optionalParams: unknown[]): void {
    this.writeNestLog(AtlasLogLevel.ERROR, message, optionalParams);
  }

  public warn(message: unknown, ...optionalParams: unknown[]): void {
    this.writeNestLog(AtlasLogLevel.WARN, message, optionalParams);
  }

  public debug(message: unknown, ...optionalParams: unknown[]): void {
    this.writeNestLog(AtlasLogLevel.DEBUG, message, optionalParams);
  }

  public verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.writeNestLog(AtlasLogLevel.TRACE, message, optionalParams);
  }

  public fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.writeNestLog(AtlasLogLevel.FATAL, message, optionalParams);
  }

  private writeNestLog(
    level: AtlasLogLevel,
    message: unknown,
    optionalParams: readonly unknown[],
  ): void {
    const parameters = [...optionalParams];
    const context =
      typeof parameters.at(-1) === 'string' ? (parameters.pop() as string) : undefined;
    const bindings: Record<string, unknown> = context ? { context } : {};
    let error: Error | undefined;
    let text: string;

    if (message instanceof Error) {
      error = message;
      text = message.message;
    } else if (typeof message === 'string') {
      text = message;
    } else {
      text = 'Application log';
      bindings.data = message;
    }

    if (level === AtlasLogLevel.ERROR && typeof parameters[0] === 'string') {
      bindings.stack = parameters.shift();
    }

    if (parameters.length > 0) {
      bindings.parameters = parameters;
    }

    this.write(level, bindings, text, error);
  }

  private emit(level: AtlasLogLevel, bindings: Record<string, unknown>, message: string): void {
    switch (level) {
      case AtlasLogLevel.FATAL:
        this.logger.fatal(bindings, message);
        return;
      case AtlasLogLevel.ERROR:
        this.logger.error(bindings, message);
        return;
      case AtlasLogLevel.WARN:
        this.logger.warn(bindings, message);
        return;
      case AtlasLogLevel.INFO:
        this.logger.info(bindings, message);
        return;
      case AtlasLogLevel.DEBUG:
        this.logger.debug(bindings, message);
        return;
      case AtlasLogLevel.TRACE:
        this.logger.trace(bindings, message);
    }
  }
}

export function createAtlasLogger(
  options: AtlasLoggerOptions,
  destination?: DestinationStream,
): AtlasLogger {
  const loggerOptions: LoggerOptions = {
    level: options.level,
    base: {
      service: options.service,
      environment: options.environment,
      ...(options.version ? { version: options.version } : {}),
    },
    messageKey: 'message',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    serializers: {
      err: pino.stdSerializers.err,
    },
    redact: {
      paths: PINO_REDACT_PATHS,
      censor: REDACTED_LOG_VALUE,
    },
  };

  const logger = destination ? pino(loggerOptions, destination) : pino(loggerOptions);
  return new AtlasLogger(logger);
}

function currentContextBindings(): Record<string, unknown> {
  const context = requestContext.get();

  if (!context) {
    return {};
  }

  return {
    requestId: context.requestId,
    traceId: context.traceId,
    ...(context.correlationId ? { correlationId: context.correlationId } : {}),
    actorType: context.actorType,
    ...(context.actorId ? { actorId: context.actorId } : {}),
    ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
    ...(context.siteId ? { siteId: context.siteId } : {}),
  };
}

function createSafeError(error: Error): Error {
  const safeError = new Error(redactLogMessage(error.message));
  safeError.name = error.name;
  safeError.stack = error.stack ? redactLogMessage(error.stack) : undefined;
  return safeError;
}
