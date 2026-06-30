/**
 * lib/team.js — Team / membership domain logic (pure, testable).
 * Guards that protect tenant integrity (e.g. never orphan a tenant by removing
 * its last owner). I/O lives in controllers/team.js.
 */

export const TEAM_ROLES = ['owner', 'admin', 'member'];

export function validateRole(role) {
  return TEAM_ROLES.includes(role);
}

/**
 * Can this member be removed without orphaning the tenant?
 * @param {Array<{user_id:string, role:string}>} members
 * @param {string} userId
 */
export function canRemoveMember(members, userId) {
  const target = (members || []).find((m) => m.user_id === userId);
  if (!target) return { ok: false, error: 'member not found' };
  const owners = (members || []).filter((m) => m.role === 'owner');
  if (target.role === 'owner' && owners.length <= 1) {
    return { ok: false, error: 'cannot remove the last owner' };
  }
  return { ok: true };
}

/**
 * Is this role change allowed?
 * @param {Array<{user_id:string, role:string}>} members
 * @param {string} userId
 * @param {string} newRole
 */
export function canChangeRole(members, userId, newRole) {
  if (!validateRole(newRole)) return { ok: false, error: `invalid role "${newRole}"` };
  const target = (members || []).find((m) => m.user_id === userId);
  if (!target) return { ok: false, error: 'member not found' };
  const owners = (members || []).filter((m) => m.role === 'owner');
  if (target.role === 'owner' && newRole !== 'owner' && owners.length <= 1) {
    return { ok: false, error: 'cannot demote the last owner' };
  }
  return { ok: true };
}

/**
 * Is this user already a member?
 * @param {Array<{user_id:string}>} members
 * @param {string} userId
 */
export function isMember(members, userId) {
  return (members || []).some((m) => m.user_id === userId);
}
