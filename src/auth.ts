import type { Context, Next } from 'hono';
import type { User, Role } from './types';
import type { Env } from './env';

export async function getUser(request: Request, env: Env): Promise<User | null> {
  const jwt = request.headers.get('CF-Access-Jwt-Assertion');
  if (!jwt) return null;

  try {
    const certsUrl = `https://${env.CF_TEAM_DOMAIN}/cdn-cgi/access/certs`;
    const certsRes = await fetch(certsUrl);
    const { keys } = await certsRes.json<{ keys: JsonWebKey[] }>();

    const [headerB64, payloadB64, sigB64] = jwt.split('.');
    const header = JSON.parse(atob(headerB64));

    const jwk = keys.find((k: JsonWebKey) => (k as { kid?: string }).kid === header.kid) ?? keys[0];
    const key = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );

    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const sig = Uint8Array.from(atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
    if (!valid) return null;

    const payload = JSON.parse(atob(payloadB64));
    if (payload.aud !== env.CF_ACCESS_AUD) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    const email = payload.email as string;
    let user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
    if (!user) {
      const id = crypto.randomUUID();
      const name = (payload.name as string | undefined) ?? email.split('@')[0];
      await env.DB.prepare(
        'INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)'
      ).bind(id, email, name, 'management').run();
      user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
    }
    return user ?? null;
  } catch {
    return null;
  }
}

export function requireAuth() {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as User | undefined;
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    await next();
  };
}

export function requireRole(...roles: Role[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as User | undefined;
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    if (!roles.includes(user.role)) return c.json({ error: 'Forbidden' }, 403);
    await next();
  };
}
