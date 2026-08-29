import { AtlasApiError, createNetworkProblem, readProblemDetails } from './problem-details';

export type ApiResponseType = 'json' | 'text' | 'void' | 'response';

export interface AtlasApiClientOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
  defaultHeaders?: HeadersInit;
  credentials?: RequestCredentials;
  getCsrfToken?: () => string | undefined;
}

export interface AtlasApiRequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  body?: unknown;
  headers?: HeadersInit;
  responseType?: ApiResponseType;
  csrfToken?: string;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class AtlasApiClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly defaultHeaders: Headers;
  private readonly credentials: RequestCredentials;
  private readonly getCsrfToken?: () => string | undefined;

  public constructor(options: AtlasApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.defaultHeaders = new Headers(options.defaultHeaders);
    this.credentials = options.credentials ?? 'include';
    this.getCsrfToken = options.getCsrfToken;
  }

  public get<TResponse>(
    path: string,
    options: Omit<AtlasApiRequestOptions, 'body' | 'method'> = {},
  ): Promise<TResponse> {
    return this.request<TResponse>(path, { ...options, method: 'GET' });
  }

  public post<TResponse>(
    path: string,
    body?: unknown,
    options: Omit<AtlasApiRequestOptions, 'body' | 'method'> = {},
  ): Promise<TResponse> {
    return this.request<TResponse>(path, { ...options, method: 'POST', body });
  }

  public patch<TResponse>(
    path: string,
    body?: unknown,
    options: Omit<AtlasApiRequestOptions, 'body' | 'method'> = {},
  ): Promise<TResponse> {
    return this.request<TResponse>(path, { ...options, method: 'PATCH', body });
  }

  public delete<TResponse>(
    path: string,
    options: Omit<AtlasApiRequestOptions, 'body' | 'method'> = {},
  ): Promise<TResponse> {
    return this.request<TResponse>(path, { ...options, method: 'DELETE' });
  }

  public async request<TResponse>(
    path: string,
    options: AtlasApiRequestOptions = {},
  ): Promise<TResponse> {
    const {
      body: requestBody,
      csrfToken: explicitCsrfToken,
      headers: requestHeaders,
      responseType = 'json',
      ...requestInit
    } = options;
    const method = (
      requestInit.method ?? (requestBody === undefined ? 'GET' : 'POST')
    ).toUpperCase();

    if ((method === 'GET' || method === 'HEAD') && requestBody !== undefined) {
      throw new TypeError(`${method} requests cannot include a body.`);
    }

    const requestUrl = this.resolvePath(path);
    const headers = mergeHeaders(this.defaultHeaders, requestHeaders);
    const body = serializeBody(requestBody, headers);
    const csrfToken = explicitCsrfToken ?? this.getCsrfToken?.();

    if (MUTATING_METHODS.has(method) && csrfToken && !headers.has('x-csrf-token')) {
      headers.set('x-csrf-token', csrfToken);
    }

    if (!headers.has('accept')) {
      headers.set('accept', 'application/json');
    }

    let response: Response;

    try {
      response = await this.fetcher(requestUrl, {
        ...requestInit,
        body,
        credentials: requestInit.credentials ?? this.credentials,
        headers,
        method,
      });
    } catch (cause) {
      throw new AtlasApiError(createNetworkProblem(), cause);
    }

    if (!response.ok) {
      throw new AtlasApiError(await readProblemDetails(response));
    }

    return parseSuccessfulResponse<TResponse>(response, responseType);
  }

  private resolvePath(path: string): string {
    const trimmed = path.trim();

    if (!trimmed) {
      throw new TypeError('API path cannot be empty.');
    }

    if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed) || trimmed.startsWith('//')) {
      throw new TypeError('Absolute API URLs are not allowed.');
    }

    const pathname = trimmed.split(/[?#]/u, 1)[0] ?? '';
    let decodedPathname: string;

    try {
      decodedPathname = decodeURIComponent(pathname).replaceAll('\\', '/');
    } catch {
      throw new TypeError('API path contains invalid encoding.');
    }

    if (decodedPathname.split('/').includes('..')) {
      throw new TypeError('API path traversal is not allowed.');
    }

    return `${this.baseUrl}${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`;
  }
}

export interface CreateAdminApiClientOptions extends Omit<AtlasApiClientOptions, 'baseUrl'> {
  baseUrl?: string;
}

export function createAdminApiClient(options: CreateAdminApiClientOptions = {}): AtlasApiClient {
  const { baseUrl, getCsrfToken, ...rest } = options;
  const apiRoot = (process.env.NEXT_PUBLIC_ATLAS_API_URL ?? '/api').replace(/\/+$/u, '');

  return new AtlasApiClient({
    ...rest,
    baseUrl: baseUrl ?? `${apiRoot}/admin/v1`,
    getCsrfToken: getCsrfToken ?? readCsrfTokenFromBrowser,
  });
}

export function readCookieValue(cookieHeader: string, name: string): string | undefined {
  if (!cookieHeader || !name) {
    return undefined;
  }

  let match: string | undefined;

  for (const segment of cookieHeader.split(';')) {
    const separator = segment.indexOf('=');

    if (separator < 1 || segment.slice(0, separator).trim() !== name) {
      continue;
    }

    if (match !== undefined) {
      return undefined;
    }

    try {
      match = decodeURIComponent(segment.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }

  return match;
}

function readCsrfTokenFromBrowser(): string | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }

  const cookieName =
    process.env.NEXT_PUBLIC_ATLAS_CSRF_COOKIE_NAME ?? 'atlas_admin_csrf';
  const cookieToken = readCookieValue(document.cookie, cookieName);

  if (cookieToken) {
    return cookieToken;
  }

  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || undefined;
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/u, '');

  if (!normalized) {
    throw new TypeError('API base URL cannot be empty.');
  }

  return normalized;
}

function mergeHeaders(defaultHeaders: Headers, requestHeaders?: HeadersInit): Headers {
  const headers = new Headers(defaultHeaders);
  const overrides = new Headers(requestHeaders);

  overrides.forEach((value, key) => headers.set(key, value));
  return headers;
}

function serializeBody(body: unknown, headers: Headers): BodyInit | undefined {
  if (body === undefined) {
    return undefined;
  }

  if (isBodyInit(body)) {
    return body;
  }

  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return JSON.stringify(body);
}

function isBodyInit(value: unknown): value is BodyInit {
  return (
    typeof value === 'string' ||
    (typeof Blob !== 'undefined' && value instanceof Blob) ||
    (typeof FormData !== 'undefined' && value instanceof FormData) ||
    (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream)
  );
}

async function parseSuccessfulResponse<TResponse>(
  response: Response,
  responseType: ApiResponseType,
): Promise<TResponse> {
  if (responseType === 'response') {
    return response as TResponse;
  }

  if (responseType === 'void' || response.status === 204 || response.status === 205) {
    return undefined as TResponse;
  }

  const text = await response.text();

  if (responseType === 'text') {
    return text as TResponse;
  }

  if (!text) {
    return undefined as TResponse;
  }

  try {
    return JSON.parse(text) as TResponse;
  } catch (cause) {
    throw new AtlasApiError(
      {
        type: 'about:blank',
        title: 'Invalid API response',
        status: 502,
        code: 'INVALID_API_RESPONSE',
        detail: 'API 응답을 해석할 수 없습니다.',
        requestId: response.headers.get('x-request-id') ?? undefined,
      },
      cause,
    );
  }
}
