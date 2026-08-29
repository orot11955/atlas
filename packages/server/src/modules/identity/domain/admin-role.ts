export const AdminRole = {
  ADMIN: 'admin',
  EDITOR: 'editor',
  OPERATOR: 'operator',
  OWNER: 'owner',
  VIEWER: 'viewer',
} as const;

export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

export const ADMIN_ROLES = Object.freeze([
  AdminRole.OWNER,
  AdminRole.ADMIN,
  AdminRole.EDITOR,
  AdminRole.OPERATOR,
  AdminRole.VIEWER,
]) as readonly AdminRole[];

export function isAdminRole(value: string): value is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(value);
}
