export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  requestId?: string;
  timestamp?: string;
  errors?: readonly string[];
  details?: Readonly<Record<string, unknown>>;
}

export class AtlasApiError extends Error {
  public readonly problem: Readonly<ProblemDetails>;

  public constructor(problem: ProblemDetails, cause?: unknown) {
    super(problem.detail, cause === undefined ? undefined : { cause });
    this.name = 'AtlasApiError';
    this.problem = Object.freeze({ ...problem });
  }

  public get status(): number {
    return this.problem.status;
  }

  public get code(): string {
    return this.problem.code;
  }

  public get requestId(): string | undefined {
    return this.problem.requestId;
  }
}

export async function readProblemDetails(response: Response): Promise<ProblemDetails> {
  const requestId = response.headers.get('x-request-id') ?? undefined;
  const payload = await readJsonBody(response);

  if (!isRecord(payload)) {
    return createFallbackProblem(response, requestId);
  }

  const errors = Array.isArray(payload.errors)
    ? payload.errors.filter((value): value is string => typeof value === 'string')
    : undefined;

  return {
    type: readNonEmptyString(payload.type) ?? 'about:blank',
    title:
      readNonEmptyString(payload.title) ??
      readNonEmptyString(response.statusText) ??
      'Request failed',
    status: response.status,
    code: readNonEmptyString(payload.code) ?? `HTTP_${response.status}`,
    detail: readNonEmptyString(payload.detail) ?? '요청을 처리하지 못했습니다.',
    requestId: readNonEmptyString(payload.requestId) ?? requestId,
    timestamp: readNonEmptyString(payload.timestamp),
    errors: errors && errors.length > 0 ? errors : undefined,
    details: isRecord(payload.details) ? Object.freeze({ ...payload.details }) : undefined,
  };
}

export function createNetworkProblem(): ProblemDetails {
  return {
    type: 'about:blank',
    title: 'Network request failed',
    status: 0,
    code: 'NETWORK_ERROR',
    detail: 'API 서버에 연결할 수 없습니다.',
  };
}

function createFallbackProblem(response: Response, requestId?: string): ProblemDetails {
  return {
    type: 'about:blank',
    title: readNonEmptyString(response.statusText) ?? 'Request failed',
    status: response.status,
    code: `HTTP_${response.status}`,
    detail: '요청을 처리하지 못했습니다.',
    requestId,
  };
}

async function readJsonBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

  if (!contentType.includes('json')) {
    return undefined;
  }

  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
