import { AdminRole } from './admin-role';

export const AdminPermission = {
  ADMIN_ACCOUNTS_MANAGE: 'admin.accounts.manage',
  ADMIN_ACCOUNTS_READ: 'admin.accounts.read',
  ADMIN_SESSIONS_READ: 'admin.sessions.read',
  ADMIN_SESSIONS_REVOKE: 'admin.sessions.revoke',
  API_CLIENTS_MANAGE: 'api-clients.manage',
  API_CLIENTS_READ: 'api-clients.read',
  AUDIT_READ: 'audit.read',
  CONTENT_MANAGE: 'content.manage',
  CONTENT_PUBLISH: 'content.publish',
  CONTENT_READ: 'content.read',
  DEPLOYMENTS_CONTROL: 'deployments.control',
  DEPLOYMENTS_READ: 'deployments.read',
  MEDIA_MANAGE: 'media.manage',
  MEDIA_READ: 'media.read',
  MEMBERS_MANAGE: 'members.manage',
  MEMBERS_READ: 'members.read',
  PROJECTS_MANAGE: 'projects.manage',
  PROJECTS_READ: 'projects.read',
  RESOURCES_MANAGE: 'resources.manage',
  RESOURCES_READ: 'resources.read',
  SECURITY_MANAGE: 'security.manage',
  SITES_MANAGE: 'sites.manage',
  SITES_READ: 'sites.read',
  WORKSPACES_MANAGE: 'workspaces.manage',
  WORKSPACES_READ: 'workspaces.read',
} as const;

export type AdminPermission = (typeof AdminPermission)[keyof typeof AdminPermission];

export const ADMIN_PERMISSIONS = Object.freeze(
  Object.values(AdminPermission),
) as readonly AdminPermission[];

const READ_PERMISSIONS = Object.freeze([
  AdminPermission.ADMIN_ACCOUNTS_READ,
  AdminPermission.ADMIN_SESSIONS_READ,
  AdminPermission.API_CLIENTS_READ,
  AdminPermission.AUDIT_READ,
  AdminPermission.CONTENT_READ,
  AdminPermission.DEPLOYMENTS_READ,
  AdminPermission.MEDIA_READ,
  AdminPermission.MEMBERS_READ,
  AdminPermission.PROJECTS_READ,
  AdminPermission.RESOURCES_READ,
  AdminPermission.SITES_READ,
  AdminPermission.WORKSPACES_READ,
]) as readonly AdminPermission[];

const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = Object.freeze({
  [AdminRole.OWNER]: ADMIN_PERMISSIONS,
  [AdminRole.ADMIN]: Object.freeze([
    ...READ_PERMISSIONS,
    AdminPermission.ADMIN_ACCOUNTS_MANAGE,
    AdminPermission.ADMIN_SESSIONS_REVOKE,
    AdminPermission.API_CLIENTS_MANAGE,
    AdminPermission.CONTENT_MANAGE,
    AdminPermission.CONTENT_PUBLISH,
    AdminPermission.MEDIA_MANAGE,
    AdminPermission.MEMBERS_MANAGE,
    AdminPermission.PROJECTS_MANAGE,
    AdminPermission.RESOURCES_MANAGE,
    AdminPermission.SITES_MANAGE,
    AdminPermission.WORKSPACES_MANAGE,
  ]),
  [AdminRole.EDITOR]: Object.freeze([
    AdminPermission.CONTENT_READ,
    AdminPermission.CONTENT_MANAGE,
    AdminPermission.CONTENT_PUBLISH,
    AdminPermission.MEDIA_READ,
    AdminPermission.MEDIA_MANAGE,
    AdminPermission.PROJECTS_READ,
    AdminPermission.RESOURCES_READ,
    AdminPermission.SITES_READ,
    AdminPermission.WORKSPACES_READ,
  ]),
  [AdminRole.OPERATOR]: Object.freeze([
    AdminPermission.AUDIT_READ,
    AdminPermission.DEPLOYMENTS_READ,
    AdminPermission.DEPLOYMENTS_CONTROL,
    AdminPermission.PROJECTS_READ,
    AdminPermission.SITES_READ,
    AdminPermission.WORKSPACES_READ,
  ]),
  [AdminRole.VIEWER]: READ_PERMISSIONS,
});

export function getAdminRolePermissions(role: AdminRole): readonly AdminPermission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasAdminPermission(role: AdminRole, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
