import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { AdminMfaAlgorithm } from '../../domain/admin-mfa';
import type {
  AdminTotpAuthenticatorPort,
  AdminTotpParameters,
  CreateAdminTotpProvisioningUriInput,
  MatchAdminTotpCodeInput,
} from '../../ports/admin-totp-authenticator.port';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SECRET_LENGTH_BYTES = 20;

export class NodeAdminTotpAuthenticator implements AdminTotpAuthenticatorPort {
  public generateSecret(): string {
    return encodeBase32(randomBytes(SECRET_LENGTH_BYTES));
  }

  public createProvisioningUri(input: CreateAdminTotpProvisioningUriInput): string {
    validateTotpParameters(input);
    const issuer = input.issuer.trim();
    const accountName = input.accountName.trim();

    if (!issuer || !accountName) {
      throw new RangeError('TOTP issuer and account name are required.');
    }

    const label = encodeURIComponent(`${issuer}:${accountName}`);
    const query = new URLSearchParams({
      secret: normalizeBase32Secret(input.secret),
      issuer,
      algorithm: input.algorithm,
      digits: String(input.digits),
      period: String(input.periodSeconds),
    });

    return `otpauth://totp/${label}?${query.toString()}`;
  }

  public matchCode(input: MatchAdminTotpCodeInput): number | undefined {
    validateTotpParameters(input);

    if (!/^\d+$/u.test(input.code) || input.code.length !== input.digits) {
      return undefined;
    }

    if (
      !Number.isSafeInteger(input.windowSteps) ||
      input.windowSteps < 0 ||
      input.windowSteps > 2
    ) {
      throw new RangeError('TOTP windowSteps must be an integer between 0 and 2.');
    }

    const currentStep = Math.floor(input.at.getTime() / 1_000 / input.periodSeconds);
    const matches: number[] = [];

    for (let offset = -input.windowSteps; offset <= input.windowSteps; offset += 1) {
      const step = currentStep + offset;

      if (
        step >= 0 &&
        safeCodeEqual(generateTotpCodeForStep(input.secret, step, input), input.code)
      ) {
        matches.push(step);
      }
    }

    return matches.length > 0 ? Math.max(...matches) : undefined;
  }
}

export function generateTotpCode(
  secret: string,
  at: Date,
  parameters: AdminTotpParameters,
): string {
  validateTotpParameters(parameters);
  const step = Math.floor(at.getTime() / 1_000 / parameters.periodSeconds);

  return generateTotpCodeForStep(secret, step, parameters);
}

function generateTotpCodeForStep(
  secret: string,
  step: number,
  parameters: AdminTotpParameters,
): string {
  if (!Number.isSafeInteger(step) || step < 0) {
    throw new RangeError('TOTP step is invalid.');
  }

  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));

  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  const modulus = 10 ** parameters.digits;

  return String(binary % modulus).padStart(parameters.digits, '0');
}

function validateTotpParameters(parameters: AdminTotpParameters): void {
  if (parameters.algorithm !== AdminMfaAlgorithm.SHA1) {
    throw new RangeError('Only SHA1 TOTP is supported.');
  }

  if (![6, 8].includes(parameters.digits)) {
    throw new RangeError('TOTP digits must be 6 or 8.');
  }

  if (
    !Number.isSafeInteger(parameters.periodSeconds) ||
    parameters.periodSeconds < 15 ||
    parameters.periodSeconds > 120
  ) {
    throw new RangeError('TOTP periodSeconds is invalid.');
  }
}

function normalizeBase32Secret(value: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[\s=-]/gu, '');

  if (normalized.length < 16 || !/^[A-Z2-7]+$/u.test(normalized)) {
    throw new RangeError('TOTP secret is invalid.');
  }

  return normalized;
}

function encodeBase32(value: Uint8Array): string {
  let bits = 0;
  let accumulator = 0;
  let output = '';

  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(accumulator >>> bits) & 31]!;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31]!;
  }

  return output;
}

function decodeBase32(value: string): Buffer {
  const normalized = normalizeBase32Secret(value);
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);

    if (index < 0) {
      throw new RangeError('TOTP secret is invalid.');
    }

    accumulator = (accumulator << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >>> bits) & 0xff);
    }
  }

  return Buffer.from(output);
}

function safeCodeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'ascii');
  const rightBuffer = Buffer.from(right, 'ascii');

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
