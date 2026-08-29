'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';

import { AtlasApiError } from '../../lib/api';
import {
  confirmTotpEnrollment,
  exchangeAuthenticationGrant,
  passwordLogin,
  startTotpEnrollment,
  verifyRecoveryCode,
  verifyTotp,
} from './auth-api';
import type {
  AdminAuthenticationGrant,
  AdminLoginChallenge,
  AdminTotpEnrollment,
} from './auth-types';

type LoginStep = 'password' | 'totp-setup' | 'totp' | 'recovery' | 'recovery-codes';

export function LoginFlow() {
  const router = useRouter();
  const [step, setStep] = useState<LoginStep>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [challenge, setChallenge] = useState<AdminLoginChallenge>();
  const [enrollment, setEnrollment] = useState<AdminTotpEnrollment>();
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const expiresAt = useMemo(() => {
    if (!challenge) {
      return undefined;
    }

    return new Intl.DateTimeFormat('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(challenge.expiresAt));
  }, [challenge]);

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const nextChallenge = await passwordLogin({ email, password });
      setPassword('');
      setChallenge(nextChallenge);

      if (nextChallenge.nextStep === 'mfa-setup') {
        const nextEnrollment = await startTotpEnrollment(nextChallenge);
        setEnrollment(nextEnrollment);
        setStep('totp-setup');
        return;
      }

      setStep('totp');
    });
  }

  async function handleTotpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!challenge) {
      resetFlow('로그인 확인 정보가 만료되었습니다. 비밀번호부터 다시 입력하세요.');
      return;
    }

    await run(async () => {
      if (step === 'totp-setup') {
        const result = await confirmTotpEnrollment(challenge, code);
        await establishSession(result);
        setRecoveryCodes(result.recoveryCodes);
        setCode('');
        setStep('recovery-codes');
        return;
      }

      const grant = await verifyTotp(challenge, code);
      await establishSession(grant);
      completeLogin();
    });
  }

  async function handleRecoverySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!challenge) {
      resetFlow('로그인 확인 정보가 만료되었습니다. 비밀번호부터 다시 입력하세요.');
      return;
    }

    await run(async () => {
      const grant = await verifyRecoveryCode(challenge, recoveryCode);
      await establishSession(grant);
      completeLogin();
    });
  }

  async function establishSession(grant: AdminAuthenticationGrant) {
    await exchangeAuthenticationGrant(grant);
    setChallenge(undefined);
    setEnrollment(undefined);
    setCode('');
    setRecoveryCode('');
  }

  function completeLogin() {
    router.replace('/admin');
    router.refresh();
  }

  function resetFlow(nextMessage?: string) {
    setStep('password');
    setPassword('');
    setCode('');
    setRecoveryCode('');
    setChallenge(undefined);
    setEnrollment(undefined);
    setRecoveryCodes([]);
    setError(undefined);
    setMessage(nextMessage);
  }

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);

    try {
      await task();
    } catch (caught) {
      setError(readErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function copyValue(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(successMessage);
      setError(undefined);
    } catch {
      setError('클립보드에 복사하지 못했습니다. 값을 직접 선택해 복사하세요.');
    }
  }

  return (
    <div className="auth-card" aria-busy={busy}>
      <div className="auth-brand">
        <span className="brand-mark" aria-hidden="true">
          A
        </span>
        <div>
          <p className="eyebrow">ATLAS CONTROL PLANE</p>
          <h1>관리자 인증</h1>
        </div>
      </div>

      {step === 'password' ? (
        <form className="auth-form" onSubmit={handlePasswordSubmit}>
          <div className="auth-copy">
            <h2>계속하려면 로그인하세요</h2>
            <p>비밀번호 검증 후 등록된 MFA 방식으로 한 번 더 확인합니다.</p>
          </div>

          <label className="field">
            <span>이메일</span>
            <input
              autoComplete="username"
              inputMode="email"
              name="email"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label className="field">
            <span>비밀번호</span>
            <input
              autoComplete="current-password"
              name="password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <button className="primary-button" disabled={busy} type="submit">
            {busy ? '확인 중…' : '다음'}
          </button>
        </form>
      ) : null}

      {step === 'totp-setup' && enrollment ? (
        <form className="auth-form" onSubmit={handleTotpSubmit}>
          <div className="auth-copy">
            <span className="step-badge">최초 1회</span>
            <h2>Authenticator를 등록하세요</h2>
            <p>
              Authenticator 앱에서 아래 Secret을 수동 등록한 뒤 생성된 6자리 코드를
              입력하세요.
            </p>
          </div>

          <div className="secret-panel">
            <span>Secret</span>
            <code>{enrollment.secret}</code>
            <button
              className="text-button"
              type="button"
              onClick={() => copyValue(enrollment.secret, 'Secret을 복사했습니다.')}
            >
              Secret 복사
            </button>
          </div>

          <details className="uri-panel">
            <summary>Provisioning URI 보기</summary>
            <code>{enrollment.provisioningUri}</code>
            <button
              className="text-button"
              type="button"
              onClick={() =>
                copyValue(enrollment.provisioningUri, 'Provisioning URI를 복사했습니다.')
              }
            >
              URI 복사
            </button>
          </details>

          <TotpField code={code} onChange={setCode} />

          <button className="primary-button" disabled={busy || code.length !== 6} type="submit">
            {busy ? '등록 확인 중…' : 'MFA 등록 완료'}
          </button>
          <button className="secondary-button" type="button" onClick={() => resetFlow()}>
            처음부터 다시
          </button>
        </form>
      ) : null}

      {step === 'totp' ? (
        <form className="auth-form" onSubmit={handleTotpSubmit}>
          <div className="auth-copy">
            <span className="step-badge">2단계 인증</span>
            <h2>6자리 인증 코드를 입력하세요</h2>
            <p>Authenticator 앱에 표시된 현재 코드를 사용합니다.</p>
          </div>

          <TotpField code={code} onChange={setCode} autoFocus />

          <button className="primary-button" disabled={busy || code.length !== 6} type="submit">
            {busy ? '인증 중…' : '로그인'}
          </button>
          <button className="text-button centered" type="button" onClick={() => setStep('recovery')}>
            Recovery Code 사용
          </button>
          <button className="secondary-button" type="button" onClick={() => resetFlow()}>
            다른 계정으로 시작
          </button>
        </form>
      ) : null}

      {step === 'recovery' ? (
        <form className="auth-form" onSubmit={handleRecoverySubmit}>
          <div className="auth-copy">
            <span className="step-badge">복구 인증</span>
            <h2>Recovery Code를 입력하세요</h2>
            <p>사용한 Recovery Code는 즉시 폐기되며 다시 사용할 수 없습니다.</p>
          </div>

          <label className="field">
            <span>Recovery Code</span>
            <input
              autoComplete="one-time-code"
              autoFocus
              name="recoveryCode"
              required
              spellCheck={false}
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())}
            />
          </label>

          <button className="primary-button" disabled={busy || recoveryCode.length < 8} type="submit">
            {busy ? '확인 중…' : 'Recovery Code로 로그인'}
          </button>
          <button className="text-button centered" type="button" onClick={() => setStep('totp')}>
            Authenticator Code 사용
          </button>
        </form>
      ) : null}

      {step === 'recovery-codes' ? (
        <section className="auth-form" aria-labelledby="recovery-title">
          <div className="auth-copy">
            <span className="step-badge success">MFA 등록 완료</span>
            <h2 id="recovery-title">Recovery Code를 안전하게 보관하세요</h2>
            <p>
              아래 코드는 다시 표시되지 않습니다. Password Manager 같은 안전한 위치에
              저장한 뒤 계속하세요.
            </p>
          </div>

          <ul className="recovery-code-list">
            {recoveryCodes.map((item) => (
              <li key={item}>
                <code>{item}</code>
              </li>
            ))}
          </ul>

          <button
            className="secondary-button"
            type="button"
            onClick={() =>
              copyValue(recoveryCodes.join('\n'), 'Recovery Code 전체를 복사했습니다.')
            }
          >
            전체 복사
          </button>
          <button className="primary-button" type="button" onClick={completeLogin}>
            보관했습니다 · 관리자 패널 열기
          </button>
        </section>
      ) : null}

      {expiresAt && step !== 'password' && step !== 'recovery-codes' ? (
        <p className="challenge-expiry">현재 인증 요청은 {expiresAt}까지 유효합니다.</p>
      ) : null}

      <div className="auth-feedback" aria-live="polite">
        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="form-message">{message}</p> : null}
      </div>
    </div>
  );
}

function TotpField({
  autoFocus = false,
  code,
  onChange,
}: Readonly<{
  autoFocus?: boolean;
  code: string;
  onChange: (value: string) => void;
}>) {
  return (
    <label className="field">
      <span>인증 코드</span>
      <input
        aria-describedby="totp-help"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        className="totp-input"
        inputMode="numeric"
        maxLength={6}
        name="code"
        pattern="[0-9]{6}"
        required
        value={code}
        onChange={(event) => onChange(event.target.value.replace(/\D/gu, '').slice(0, 6))}
      />
      <small id="totp-help">숫자 6자리</small>
    </label>
  );
}

function readErrorMessage(error: unknown): string {
  if (error instanceof AtlasApiError) {
    const suffix = error.requestId ? ` · 요청 ID ${error.requestId}` : '';
    return `${error.problem.detail}${suffix}`;
  }

  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.';
}
