export const AdminAccountStatus = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
} as const;

export type AdminAccountStatus = (typeof AdminAccountStatus)[keyof typeof AdminAccountStatus];
