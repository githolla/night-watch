import { encrypt, decrypt } from './crypto.ts';
import type { AppUser } from './users.ts';
export const ACTING_COOKIE = 'nw_acting';
export const ACTING_MAX_AGE = 3600;
export function issueActingSession(actorId: string, targetId: string) {
  return encrypt(JSON.stringify({ purpose: 'act-as', actorId, targetId, exp: Date.now() + ACTING_MAX_AGE * 1000 }));
}
export function actingTarget(token: string, actor: AppUser): string {
  try {
    const value = JSON.parse(decrypt(token));
    if (actor.role !== 'admin' || value.purpose !== 'act-as' || value.actorId !== actor.id || typeof value.targetId !== 'string' || !value.targetId || typeof value.exp !== 'number' || value.exp <= Date.now()) throw new Error();
    return value.targetId;
  } catch { throw new Error('Act-as session expired or invalid. Exit admin mode and start again.'); }
}
