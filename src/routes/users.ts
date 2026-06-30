import { Hono } from 'hono';
import type { User, Role } from '../types';
import type { Env } from '../env';
import { requireRole } from '../auth';
import { sendEmail } from '../email';

const users = new Hono<{ Bindings: Env; Variables: { user: User } }>();

users.get('/', requireRole('admin', 'board'), async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT * FROM users ORDER BY name'
  ).all<User>();
  return c.json(result.results);
});

users.get('/me', async (c) => {
  return c.json(c.get('user'));
});

users.post('/invite', requireRole('admin'), async (c) => {
  const { email, name, role } = await c.req.json<{ email: string; name: string; role: Role }>();
  if (!email || !name || !role) return c.json({ error: 'email, name, role required' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'User already exists' }, 409);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)'
  ).bind(id, email, name, role).run();

  await sendEmail(c.env, {
    to: email,
    subject: 'You have been invited to HOA Tracker',
    text: `Hi ${name},\n\nYou've been added to the Bellaire Tower HOA Tracker as ${role}.\n\nAccess it here: ${c.env.APP_URL}`,
    html: `<p>Hi ${name},</p><p>You've been added to the Bellaire Tower HOA Tracker as <strong>${role}</strong>.</p><p><a href="${c.env.APP_URL}">Open Tracker</a></p>`,
  });

  return c.json({ id, email, name, role }, 201);
});

users.patch('/:id', requireRole('admin'), async (c) => {
  const { name, role, active } = await c.req.json<{ name?: string; role?: Role; active?: boolean }>();
  const fields: string[] = [];
  const values: (string | number)[] = [];
  if (name   !== undefined) { fields.push('name = ?');   values.push(name); }
  if (role   !== undefined) { fields.push('role = ?');   values.push(role); }
  if (active !== undefined) { fields.push('active = ?'); values.push(active ? 1 : 0); }
  if (!fields.length) return c.json({ error: 'Nothing to update' }, 400);
  await c.env.DB.prepare(
    `UPDATE users SET ${fields.join(', ')} WHERE id = ?`
  ).bind(...values, c.req.param('id')).run();
  return c.json({ ok: true });
});

export default users;
