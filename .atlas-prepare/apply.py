from pathlib import Path
import shutil


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    content = file.read_text(encoding='utf-8')
    count = content.count(old)

    if count != 1:
        raise RuntimeError(f'{path}: expected one match, found {count}')

    file.write_text(content.replace(old, new, 1), encoding='utf-8')


for source in Path('.atlas-prepare/overlay').rglob('*'):
    if not source.is_file():
        continue

    relative = source.relative_to('.atlas-prepare/overlay')
    target = Path(relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)

replace_once(
    'packages/server/src/modules/identity/application/admin-password-login.service.ts',
    "  nextStep: 'mfa';\n",
    "  nextStep: 'mfa' | 'mfa-setup';\n",
)
replace_once(
    'packages/server/src/modules/identity/application/admin-password-login.service.ts',
    """      await this.recordAttemptAndAudit(
        {
          accountId: current.id,
          outcome: AdminLoginAttemptOutcome.PASSWORD_VERIFIED,
          emailFingerprint,
          ipFingerprint,
          attemptedAt,
        },
        transaction,
      );

      return {
""",
    """      await this.recordAttemptAndAudit(
        {
          accountId: current.id,
          outcome: AdminLoginAttemptOutcome.PASSWORD_VERIFIED,
          emailFingerprint,
          ipFingerprint,
          attemptedAt,
        },
        transaction,
      );

      const hasActiveTotpMethod =
        await this.repository.hasActiveTotpMethod(current.id, transaction);

      return {
""",
)
replace_once(
    'packages/server/src/modules/identity/application/admin-password-login.service.ts',
    "          nextStep: 'mfa',\n",
    """          nextStep: hasActiveTotpMethod ? 'mfa' : 'mfa-setup',
""",
)

replace_once(
    'packages/server/src/admin-password-login.test.ts',
    """  public readonly challenges: AdminLoginChallengeRecord[] = [];
  public findByEmailCount = 0;
""",
    """  public readonly challenges: AdminLoginChallengeRecord[] = [];
  public readonly activeTotpAccountIds = new Set<string>();
  public findByEmailCount = 0;
""",
)
replace_once(
    'packages/server/src/admin-password-login.test.ts',
    """  public async updateLoginState(
""",
    """  public async hasActiveTotpMethod(
    accountId: string,
    _transaction?: TestTransaction,
  ): Promise<boolean> {
    return this.activeTotpAccountIds.has(accountId);
  }

  public async updateLoginState(
""",
)
replace_once(
    'packages/server/src/admin-password-login.test.ts',
    """class TestChallengeIssuer implements AdminLoginChallengeTokenIssuerPort {
  public issue(_issuedAt: Date): Readonly<IssuedAdminLoginChallengeToken> {
    return Object.freeze({
      id: '0199-0000-7000-8000-000000000001',
      token: 'atlas_mfa_0199-0000-7000-8000-000000000001.secret',
      tokenDigest: 'a'.repeat(64),
    });
  }
}
""",
    """class TestChallengeIssuer implements AdminLoginChallengeTokenIssuerPort {
  public issue(_issuedAt: Date): Readonly<IssuedAdminLoginChallengeToken> {
    return Object.freeze({
      id: '0199-0000-7000-8000-000000000001',
      token: 'atlas_mfa_0199-0000-7000-8000-000000000001.secret',
      tokenDigest: 'a'.repeat(64),
    });
  }

  public digest(token: string): string {
    return token ===
      'atlas_mfa_0199-0000-7000-8000-000000000001.secret'
      ? 'a'.repeat(64)
      : 'b'.repeat(64);
  }

  public matches(token: string, expectedDigest: string): boolean {
    return this.digest(token) === expectedDigest;
  }
}
""",
)
replace_once(
    'packages/server/src/admin-password-login.test.ts',
    "  assert.equal(result.nextStep, 'mfa');\n",
    "  assert.equal(result.nextStep, 'mfa-setup');\n",
)

replace_once(
    '.env.example',
    'AUTH_MFA_CHALLENGE_SECONDS=300\n',
    """AUTH_MFA_CHALLENGE_SECONDS=300
# Local-only 32-byte key encoded as standard Base64.
AUTH_MFA_ENCRYPTION_KEY_BASE64=YXRsYXMtbG9jYWwtbWZhLWVuY3J5cHRpb24ta2V5LTE=
AUTH_MFA_ENCRYPTION_KEY_VERSION=local-v1
AUTH_MFA_RECOVERY_CODE_PEPPER=atlas-admin-recovery-code-local-secret
AUTH_MFA_ISSUER=Atlas
AUTH_MFA_WINDOW_STEPS=1
AUTH_MFA_GRANT_SECONDS=120
AUTH_MFA_RECOVERY_CODE_COUNT=10
AUTH_MFA_FAILURE_THRESHOLD=5
""",
)
replace_once(
    'compose.yml',
    '      AUTH_MFA_CHALLENGE_SECONDS: ${AUTH_MFA_CHALLENGE_SECONDS:-300}\n',
    """      AUTH_MFA_CHALLENGE_SECONDS: ${AUTH_MFA_CHALLENGE_SECONDS:-300}
      AUTH_MFA_ENCRYPTION_KEY_BASE64: ${AUTH_MFA_ENCRYPTION_KEY_BASE64:-YXRsYXMtbG9jYWwtbWZhLWVuY3J5cHRpb24ta2V5LTE=}
      AUTH_MFA_ENCRYPTION_KEY_VERSION: ${AUTH_MFA_ENCRYPTION_KEY_VERSION:-local-v1}
      AUTH_MFA_RECOVERY_CODE_PEPPER: ${AUTH_MFA_RECOVERY_CODE_PEPPER:-atlas-admin-recovery-code-local-secret}
      AUTH_MFA_ISSUER: ${AUTH_MFA_ISSUER:-Atlas}
      AUTH_MFA_WINDOW_STEPS: ${AUTH_MFA_WINDOW_STEPS:-1}
      AUTH_MFA_GRANT_SECONDS: ${AUTH_MFA_GRANT_SECONDS:-120}
      AUTH_MFA_RECOVERY_CODE_COUNT: ${AUTH_MFA_RECOVERY_CODE_COUNT:-10}
      AUTH_MFA_FAILURE_THRESHOLD: ${AUTH_MFA_FAILURE_THRESHOLD:-5}
""",
)

replace_once(
    '.github/workflows/ci.yml',
    '      AUTH_LOGIN_FINGERPRINT_PEPPER: atlas-ci-admin-login-fingerprint-secret\n',
    """      AUTH_LOGIN_FINGERPRINT_PEPPER: atlas-ci-admin-login-fingerprint-secret
      AUTH_MFA_ENCRYPTION_KEY_BASE64: MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
      AUTH_MFA_ENCRYPTION_KEY_VERSION: ci-v1
      AUTH_MFA_RECOVERY_CODE_PEPPER: atlas-ci-admin-recovery-code-pepper-2026
      AUTH_MFA_ISSUER: Atlas CI
      AUTH_MFA_WINDOW_STEPS: 1
      AUTH_MFA_GRANT_SECONDS: 120
      AUTH_MFA_RECOVERY_CODE_COUNT: 10
      AUTH_MFA_FAILURE_THRESHOLD: 5
""",
)

ci_path = Path('.github/workflows/ci.yml')
ci_content = ci_path.read_text(encoding='utf-8')
marker = '      - name: Verify Admin Password Login API\n'
index = ci_content.find(marker)

if index < 0:
    raise RuntimeError('CI password login step marker was not found.')

ci_content = ci_content[:index] + """      - name: Verify Admin Password and TOTP MFA API
        run: |
          pnpm build:packages
          pnpm --filter @atlas/api build
          pnpm --filter @atlas/api start > /tmp/atlas-api.log 2>&1 &
          api_pid=$!
          trap 'kill "$api_pid" 2>/dev/null || true; rm -f /tmp/atlas-owner-password' EXIT

          for attempt in $(seq 1 30); do
            if curl -fsS http://localhost:4000/api/health/live > /dev/null; then
              break
            fi

            if [ "$attempt" = '30' ]; then
              cat /tmp/atlas-api.log
              exit 1
            fi

            sleep 1
          done

          ATLAS_OWNER_PASSWORD="$(cat /tmp/atlas-owner-password)" \\
            node scripts/ci/admin-auth-e2e.mjs
"""
ci_path.write_text(ci_content, encoding='utf-8')

Path('.github/workflows/format-admin-login-hardening-once.yml').unlink(missing_ok=True)
print('Applied admin TOTP MFA integration patches.')
