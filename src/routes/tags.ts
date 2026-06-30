import { Hono } from 'hono';
import type { User } from '../types';
import type { Env } from '../env';
import { requireRole } from '../auth';

const tags = new Hono<{ Bindings: Env; Variables: { user: User } }>();

tags.get('/', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT t.*, COUNT(tt.task_id) as task_count
    FROM tags t LEFT JOIN task_tags tt ON tt.tag_id = t.id
    GROUP BY t.id ORDER BY t.name
  `).all();
  return c.json(result.results);
});

tags.post('/', requireRole('admin', 'board'), async (c) => {
  const { name, color } = await c.req.json<{ name: string; color?: string }>();
  if (!name) return c.json({ error: 'name required' }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO tags (id, name, color) VALUES (?, ?, ?)'
  ).bind(id, name, color ?? '#6366f1').run();
  return c.json({ id, name, color: color ?? '#6366f1' }, 201);
});

tags.patch('/:id', requireRole('admin'), async (c) => {
  const { name, color } = await c.req.json<{ name?: string; color?: string }>();
  const fields: string[] = [];
  const values: string[] = [];
  if (name)  { fields.push('name = ?');  values.push(name); }
  if (color) { fields.push('color = ?'); values.push(color); }
  if (!fields.length) return c.json({ error: 'Nothing to update' }, 400);
  await c.env.DB.prepare(
    `UPDATE tags SET ${fields.join(', ')} WHERE id = ?`
  ).bind(...values, c.req.param('id')).run();
  return c.json({ ok: true });
});

tags.post('/:id/merge/:targetId', requireRole('admin'), async (c) => {
  const fromId = c.req.param('id');
  const toId   = c.req.param('targetId');
  await c.env.DB.prepare(
    'UPDATE OR IGNORE task_tags SET tag_id = ? WHERE tag_id = ?'
  ).bind(toId, fromId).run();
  await c.env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(fromId).run();
  return c.json({ ok: true });
});

tags.delete('/:id', requireRole('admin'), async (c) => {
  await c.env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

export default tags;
