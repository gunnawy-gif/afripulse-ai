import crypto from 'node:crypto';
import { sql, one } from './db.ts';

export type Role = 'super_admin' | 'lga_admin' | 'reviewer' | 'analyst';

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  lga: string | null;
};

const SESSION_DAYS = 7;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export async function createSession(userId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await sql.query(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`,
    [token, userId]
  );
  return token;
}

export function sessionCookie(token: string): string {
  return `afri_session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return 'afri_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax';
}

export function readCookie(req: import('node:http').IncomingMessage, name: string): string | null {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export async function userFromRequest(req: import('node:http').IncomingMessage): Promise<SessionUser | null> {
  const token = readCookie(req, 'afri_session');
  if (!token) return null;
  return userFromToken(token);
}

export async function userFromToken(token: string): Promise<SessionUser | null> {
  const row = await one<{
    id: number; name: string; email: string; role: Role; lga: string | null;
  }>(
    `SELECT u.id, u.name, u.email, u.role, u.lga FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now() AND u.active = TRUE`,
    [token]
  );
  return row ?? null;
}

export async function destroySession(req: import('node:http').IncomingMessage): Promise<void> {
  const token = readCookie(req, 'afri_session');
  if (token) await sql.query('DELETE FROM sessions WHERE token = $1', [token]);
}

const ROLE_RANK: Record<Role, number> = {
  analyst: 1, reviewer: 2, lga_admin: 3, super_admin: 4,
};

/** Permission gate. 'view' | 'review' | 'administer' | 'users' */
export function can(user: SessionUser, level: 'view' | 'review' | 'administer' | 'users'): boolean {
  const rank = ROLE_RANK[user.role];
  switch (level) {
    case 'view': return rank >= 1;
    case 'review': return rank >= 2;
    case 'administer': return rank >= 3;
    case 'users': return rank >= 4;
  }
}

export async function audit(
  actor: SessionUser | null,
  action: string,
  entity: string,
  entityId: string | null,
  details: unknown,
  ip: string | null
): Promise<void> {
  await sql.query(
    'INSERT INTO audit_logs (user_id, actor_name, action, entity, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [actor?.id ?? null, actor?.name ?? 'system', action, entity, entityId, details ? JSON.stringify(details) : null, ip]
  );
}

export function clientIp(req: import('node:http').IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}
