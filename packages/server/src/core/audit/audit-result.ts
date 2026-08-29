export const AuditResult = {
  DENIED: 'denied',
  FAILURE: 'failure',
  SUCCESS: 'success',
} as const;

export type AuditResult = (typeof AuditResult)[keyof typeof AuditResult];
