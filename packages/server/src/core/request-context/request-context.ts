import { AsyncLocalStorage } from 'node:async_hooks';

import { ApplicationError } from '../errors/application-error';
import { ErrorCode } from '../errors/error-code';

export const ActorType = {
  ADMIN: 'admin',
  ANONYMOUS: 'anonymous',
  API_CLIENT: 'api-client',
  MEMBER: 'member',
  SYSTEM: 'system',
} as const;

export type ActorType = (typeof ActorType)[keyof typeof ActorType];

export interface RequestContext {
  requestId: string;
  traceId: string;
  correlationId?: string;
  actorType: ActorType;
  actorId?: string;
  workspaceId?: string;
  siteId?: string;
}

export class RequestContextStore {
  private readonly storage = new AsyncLocalStorage<Readonly<RequestContext>>();

  public run<TResult>(context: RequestContext, callback: () => TResult): TResult {
    return this.storage.run(Object.freeze({ ...context }), callback);
  }

  public get(): Readonly<RequestContext> | undefined {
    return this.storage.getStore();
  }

  public require(): Readonly<RequestContext> {
    const context = this.get();

    if (!context) {
      throw new ApplicationError({
        code: ErrorCode.REQUEST_CONTEXT_REQUIRED,
        message: 'Request context is not available in the current execution scope.',
      });
    }

    return context;
  }
}

export const requestContext = new RequestContextStore();
