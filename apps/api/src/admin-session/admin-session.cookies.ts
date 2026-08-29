export interface AdminSessionCookieConfiguration {
  sessionCookieName: string;
  csrfCookieName: string;
  secure: boolean;
  path: '/';
  sameSite: 'lax';
}

export interface AdminCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge?: number;
}

const COOKIE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const MAX_COOKIE_HEADER_LENGTH = 16_384;
const MAX_COOKIE_VALUE_LENGTH = 1_024;

export function validateAdminSessionCookieConfiguration(
  configuration: AdminSessionCookieConfiguration,
): Readonly<AdminSessionCookieConfiguration> {
  if (
    !COOKIE_NAME_PATTERN.test(configuration.sessionCookieName) ||
    !COOKIE_NAME_PATTERN.test(configuration.csrfCookieName) ||
    configuration.sessionCookieName === configuration.csrfCookieName
  ) {
    throw new RangeError('Administrator cookie names are invalid or conflict.');
  }

  return Object.freeze({ ...configuration });
}

export function readRequestCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader || cookieHeader.length > MAX_COOKIE_HEADER_LENGTH) {
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

    const encoded = segment.slice(separator + 1).trim();

    if (encoded.length < 1 || encoded.length > MAX_COOKIE_VALUE_LENGTH) {
      return undefined;
    }

    try {
      match = decodeURIComponent(encoded);
    } catch {
      return undefined;
    }
  }

  return match;
}

export function createSessionCookieOptions(
  configuration: AdminSessionCookieConfiguration,
  expiresAt: Date,
  now: Date,
): Readonly<AdminCookieOptions> {
  return Object.freeze({
    httpOnly: true,
    secure: configuration.secure,
    sameSite: configuration.sameSite,
    path: configuration.path,
    maxAge: Math.max(1_000, expiresAt.getTime() - now.getTime()),
  });
}

export function createCsrfCookieOptions(
  configuration: AdminSessionCookieConfiguration,
  expiresAt: Date,
  now: Date,
): Readonly<AdminCookieOptions> {
  return Object.freeze({
    httpOnly: false,
    secure: configuration.secure,
    sameSite: configuration.sameSite,
    path: configuration.path,
    maxAge: Math.max(1_000, expiresAt.getTime() - now.getTime()),
  });
}

export function createClearSessionCookieOptions(
  configuration: AdminSessionCookieConfiguration,
): Readonly<AdminCookieOptions> {
  return Object.freeze({
    httpOnly: true,
    secure: configuration.secure,
    sameSite: configuration.sameSite,
    path: configuration.path,
  });
}

export function createClearCsrfCookieOptions(
  configuration: AdminSessionCookieConfiguration,
): Readonly<AdminCookieOptions> {
  return Object.freeze({
    httpOnly: false,
    secure: configuration.secure,
    sameSite: configuration.sameSite,
    path: configuration.path,
  });
}
