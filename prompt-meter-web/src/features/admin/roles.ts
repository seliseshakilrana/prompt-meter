// Pure role helpers (no SDK import, so tests can load this file directly).
// This is UI gating only: the real guard is the ModelPrice WRITE/EDIT/DELETE
// policy in Blocks (infra/blocks/data/rules.json), per PLAN.md "Access rules".

export const PLATFORM_ADMIN_ROLE = "platform-admin";

/**
 * True when `roles` (as returned in `iam.me().data.roles`) contains `role`.
 * Compared trimmed and case-insensitively; anything that is not a string array
 * counts as "no roles", so a malformed profile fails closed.
 *
 * TODO(live): confirm `iam.me()` returns role slugs (`platform-admin`) rather than
 * display names ("Platform Admin") in `roles` for this project.
 */
export function hasRole(roles: unknown, role: string): boolean {
  if (!Array.isArray(roles)) return false;
  const wanted = role.trim().toLowerCase();
  if (!wanted) return false;
  return roles.some((entry) => typeof entry === "string" && entry.trim().toLowerCase() === wanted);
}

export function isPlatformAdmin(roles: unknown): boolean {
  return hasRole(roles, PLATFORM_ADMIN_ROLE);
}
