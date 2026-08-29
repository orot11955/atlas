import { createAdminApiClient } from '../../lib/api';
import type {
  AdminAuthenticationGrant,
  AdminLoginChallenge,
  AdminSession,
  AdminSessionListItem,
  AdminTotpEnrollment,
  AdminTotpEnrollmentConfirmation,
  ApiEnvelope,
} from './auth-types';

function createClient() {
  return createAdminApiClient();
}

export async function passwordLogin(input: {
  email: string;
  password: string;
}): Promise<AdminLoginChallenge> {
  const response = await createClient().post<ApiEnvelope<AdminLoginChallenge>>(
    '/auth/login',
    input,
  );
  return response.data;
}

export async function startTotpEnrollment(
  challenge: AdminLoginChallenge,
): Promise<AdminTotpEnrollment> {
  const response = await createClient().post<ApiEnvelope<AdminTotpEnrollment>>(
    '/auth/mfa/totp/enrollment',
    challengeBody(challenge),
  );
  return response.data;
}

export async function confirmTotpEnrollment(
  challenge: AdminLoginChallenge,
  code: string,
): Promise<AdminTotpEnrollmentConfirmation> {
  const response = await createClient().post<
    ApiEnvelope<AdminTotpEnrollmentConfirmation>
  >('/auth/mfa/totp/confirm', {
    ...challengeBody(challenge),
    code,
  });
  return response.data;
}

export async function verifyTotp(
  challenge: AdminLoginChallenge,
  code: string,
): Promise<AdminAuthenticationGrant> {
  const response = await createClient().post<ApiEnvelope<AdminAuthenticationGrant>>(
    '/auth/mfa/totp/verify',
    {
      ...challengeBody(challenge),
      code,
    },
  );
  return response.data;
}

export async function verifyRecoveryCode(
  challenge: AdminLoginChallenge,
  recoveryCode: string,
): Promise<AdminAuthenticationGrant> {
  const response = await createClient().post<ApiEnvelope<AdminAuthenticationGrant>>(
    '/auth/mfa/recovery/verify',
    {
      ...challengeBody(challenge),
      recoveryCode,
    },
  );
  return response.data;
}

export async function exchangeAuthenticationGrant(
  grant: AdminAuthenticationGrant,
): Promise<AdminSession> {
  const response = await createClient().post<ApiEnvelope<AdminSession>>('/auth/session', {
    grantId: grant.grantId,
    grantToken: grant.grantToken,
  });
  return response.data;
}

export async function loadCurrentSession(): Promise<AdminSession> {
  const response = await createClient().get<ApiEnvelope<AdminSession>>('/auth/session');
  return response.data;
}

export async function loadAdminSessions(): Promise<readonly AdminSessionListItem[]> {
  const response = await createClient().get<ApiEnvelope<readonly AdminSessionListItem[]>>(
    '/auth/sessions',
  );
  return response.data;
}

export async function logoutAdminSession(): Promise<void> {
  await createClient().post<void>('/auth/logout', undefined, {
    responseType: 'void',
  });
}

export async function revokeOtherAdminSessions(): Promise<number> {
  const response = await createClient().post<ApiEnvelope<{ revokedCount: number }>>(
    '/auth/sessions/revoke-others',
  );
  return response.data.revokedCount;
}

export async function revokeAdminSession(sessionId: string): Promise<void> {
  await createClient().post<void>(`/auth/sessions/${encodeURIComponent(sessionId)}/revoke`, undefined, {
    responseType: 'void',
  });
}

function challengeBody(challenge: AdminLoginChallenge) {
  return {
    challengeId: challenge.challengeId,
    challengeToken: challenge.challengeToken,
  };
}
