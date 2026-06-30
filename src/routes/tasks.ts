import { Hono } from 'hono';
import type { User, Role, Status, Priority, ResponsibilityGroup, Task } from '../types';
import type { Env } from '../env';
import { requireRole } from '../auth';
import { addSystemComment, enrichTask, getTaskWithDetail } from '../db';
import { notifySubscribers, notifyBoard } from '../email';

const tasks = new Hono<{ Bindings: Env; Variables: { user: User } }>();

const STATUS_WEIGHT: Record<Status, number> = {
  overdue: 1000, blocked: 800, in_progress: 400, not_started: 200, complete: 0,
};
const PRIORITY_WEIGHT: Record<Priority, number> = {
  urgent: 500, high: 300, normal: 100, low: 0,
};

function computeSortScore(task: Task, viewerRole: Role, viewerUserId: string): number {
  let score = (STATUS_WEIGHT[task.status] ?? 0) + (PRIORITY_WEIGHT[task.priority] ?? 0);
  if (viewerRole === 'board' && task.awaiting_board) score += 900;
  if (viewerRole === 'management' && task.owner_id === viewerUserId) score += 600;
  if (task.due_date) {
    const days = (new Date(task.due_date).getTime() - Date.now()) / 86400000;
    if (days < 0)        score += 400;
    else if (days <= 3)  score += 350;
    else if (days <= 7)  score += 200;
    else if (days <= 14) score += 100;
  }
  return score;
}

tasks.get('/', async (c) => {
  const user = c.get('user');
  const { status, priority, group, owner, tag, awaiting, sort = 'smart' } = c.req.query();

  let sql = `
    SELECT t.*, u.name as owner_name, u.email as owner_email
    FROM tasks t LEFT JOIN users u ON u.id = t.owner_id
    WHERE t.archived_at IS NULL
  `;
  const params: (string | number)[] = [];

  if (status)   { sql += ` AND t.status = ?`;               params.push(status); }
  if (priority) { sql += ` AND t.priority = ?`;             params.push(priority); }
  if (group)    { sql += ` AND t.responsibility_group = ?`; params.push(group); }
  if (owner)    { sql += ` AND t.owner_id = ?`;             params.push(owner); }
  if (awaiting) { sql += ` AND t.awaiting_board = 1`; }

  if (tag) {
    sql += ` AND t.id IN (SELECT task_id FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tg.name = ?)`;
    params.push(tag);
  }

  // Vendor role: only their assigned tasks
  if (user.role === 'vendor') {
    sql += ` AND t.owner_id = ?`;
    params.push(user.id);
  }

  sql += ` ORDER BY t.updated_at DESC`;

  const result = await c.env.DB.prepare(sql).bind(...params).all<Record<string, unknown>>();
  const enriched = await Promise.all(result.results.map(r => enrichTask(c.env.DB, r)));

  if (sort === 'smart') {
    enriched.sort((a, b) => {
      const diff = computeSortScore(b, user.role, user.id) - computeSortScore(a, user.role, user.id);
      return diff !== 0 ? diff : new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }

  return c.json(enriched);
});

tasks.get('/archive', async (c) => {
  const { q } = c.req.query();
  let sql: string;
  const params: (string | number)[] = [];

  if (q) {
    sql = `
      SELECT t.*, u.name as owner_name, u.email as owner_email
      FROM tasks_fts fts
      JOIN tasks t ON t.id = fts.rowid
      LEFT JOIN users u ON u.id = t.owner_id
      WHERE fts.tasks_fts MATCH ? AND t.archived_at IS NOT NULL
      ORDER BY rank
    `;
    params.push(q);
  } else {
    sql = `
      SELECT t.*, u.name as owner_name, u.email as owner_email
      FROM tasks t LEFT JOIN users u ON u.id = t.owner_id
      WHERE t.archived_at IS NOT NULL
      ORDER BY t.archived_at DESC
    `;
  }

  const result = await c.env.DB.prepare(sql).bind(...params).all<Record<string, unknown>>();
  const enriched = await Promise.all(result.results.map(r => enrichTask(c.env.DB, r)));
  return c.json(enriched);
});

tasks.get('/:id', async (c) => {
  const user = c.get('user');
  const task = await getTaskWithDetail(c.env.DB, parseInt(c.req.param('id')), user.id);
  if (!task) return c.json({ error: 'Not found' }, 404);
  return c.json(task);
});

tasks.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<Partial<Task>>();

  if (!body.title) return c.json({ error: 'title required' }, 400);

  const id = await c.env.DB.prepare(`
    INSERT INTO tasks (title, description, status, priority, responsibility_group,
      owner_id, due_date, estimated_cost, is_recurring, recurrence_rule, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    body.title,
    body.description ?? null,
    body.status ?? 'not_started',
    body.priority ?? 'normal',
    body.responsibility_group ?? 'management',
    body.owner_id ?? null,
    body.due_date ?? null,
    body.estimated_cost ?? null,
    body.is_recurring ? 1 : 0,
    body.recurrence_rule ?? null,
    user.id,
  ).run();

  const taskId = id.meta.last_row_id as number;

  if (body.tags?.length) {
    for (const tag of body.tags) {
      await c.env.DB.prepare(
        'INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)'
      ).bind(taskId, tag.id).run();
    }
  }

  await c.env.DB.prepare(
    'INSERT INTO subscriptions (task_id, user_id) VALUES (?, ?)'
  ).bind(taskId, user.id).run();

  const task = await getTaskWithDetail(c.env.DB, taskId, user.id);
  return c.json(task, 201);
});

tasks.patch('/:id', async (c) => {
  const user = c.get('user');
  const taskId = parseInt(c.req.param('id'));
  const body = await c.req.json<Partial<Task> & { tag_ids?: string[] }>();

  const existing = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?')
    .bind(taskId).first<Task>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  // Management cannot write board_direction
  if (body.board_direction !== undefined && user.role === 'management') {
    return c.json({ error: 'Forbidden: management cannot set board direction' }, 403);
  }

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  const allowed: (keyof Task)[] = [
    'title', 'description', 'status', 'priority', 'responsibility_group',
    'owner_id', 'due_date', 'awaiting_board', 'awaiting_board_text',
    'estimated_cost', 'approved_budget', 'is_recurring', 'recurrence_rule',
  ];

  if (user.role !== 'management') {
    allowed.push('board_direction', 'board_direction_date');
  }

  for (const key of allowed) {
    if (body[key] !== undefined) {
      fields.push(`${key} = ?`);
      const val = body[key];
      values.push(typeof val === 'boolean' ? (val ? 1 : 0) : (val as string | number | null));
    }
  }

  if (body.board_direction && body.board_direction !== existing.board_direction) {
    fields.push('board_direction_by = ?', 'board_direction_date = ?');
    values.push(user.id, new Date().toISOString().split('T')[0]);
  }

  if (fields.length) {
    await c.env.DB.prepare(
      `UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`
    ).bind(...values, taskId).run();
  }

  if (body.tag_ids !== undefined) {
    await c.env.DB.prepare('DELETE FROM task_tags WHERE task_id = ?').bind(taskId).run();
    for (const tagId of body.tag_ids) {
      await c.env.DB.prepare(
        'INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)'
      ).bind(taskId, tagId).run();
    }
  }

  // System comments for key field changes
  if (body.status && body.status !== existing.status) {
    await addSystemComment(c.env.DB, taskId, user,
      `Status changed from ${existing.status} to ${body.status}`);
  }
  if (body.awaiting_board && !existing.awaiting_board) {
    await addSystemComment(c.env.DB, taskId, user, 'Marked as Awaiting Board');
    const task = await getTaskWithDetail(c.env.DB, taskId);
    if (task) await notifyBoard(c.env, { type: 'awaiting_board', actor: user, task, detail: body.awaiting_board_text });
  }
  if (body.board_direction && body.board_direction !== existing.board_direction) {
    await addSystemComment(c.env.DB, taskId, user, `Board direction recorded: ${body.board_direction}`);
    const task = await getTaskWithDetail(c.env.DB, taskId);
    if (task) await notifySubscribers(c.env, taskId, { type: 'board_direction', actor: user, task, detail: body.board_direction });
  }

  const task = await getTaskWithDetail(c.env.DB, taskId, user.id);
  return c.json(task);
});

tasks.delete('/:id/archive', requireRole('board', 'admin'), async (c) => {
  const user = c.get('user');
  const taskId = parseInt(c.req.param('id'));
  await c.env.DB.prepare(
    `UPDATE tasks SET archived_at = datetime('now') WHERE id = ?`
  ).bind(taskId).run();
  await addSystemComment(c.env.DB, taskId, user, 'Task archived');
  return c.json({ ok: true });
});

tasks.post('/:id/restore', requireRole('board', 'admin'), async (c) => {
  const user = c.get('user');
  const taskId = parseInt(c.req.param('id'));
  await c.env.DB.prepare(
    'UPDATE tasks SET archived_at = NULL WHERE id = ?'
  ).bind(taskId).run();
  await addSystemComment(c.env.DB, taskId, user, 'Task restored from archive');
  const task = await getTaskWithDetail(c.env.DB, taskId, user.id);
  return c.json(task);
});

tasks.post('/:id/subscribe', async (c) => {
  const user = c.get('user');
  const taskId = parseInt(c.req.param('id'));
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO subscriptions (task_id, user_id) VALUES (?, ?)'
  ).bind(taskId, user.id).run();
  return c.json({ ok: true });
});

tasks.delete('/:id/subscribe', async (c) => {
  const user = c.get('user');
  const taskId = parseInt(c.req.param('id'));
  await c.env.DB.prepare(
    'DELETE FROM subscriptions WHERE task_id = ? AND user_id = ?'
  ).bind(taskId, user.id).run();
  return c.json({ ok: true });
});

tasks.post('/:id/approve', requireRole('board', 'admin'), async (c) => {
  const user = c.get('user');
  const taskId = parseInt(c.req.param('id'));
  const { vote, note } = await c.req.json<{ vote: 'approve' | 'decline'; note?: string }>();

  await c.env.DB.prepare(
    'INSERT OR REPLACE INTO approvals (id, task_id, user_id, vote, note) VALUES (?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), taskId, user.id, vote, note ?? null).run();

  await addSystemComment(c.env.DB, taskId, user,
    `${vote === 'approve' ? 'Approved' : 'Declined'}${note ? `: ${note}` : ''}`);

  return c.json({ ok: true });
});

tasks.post('/:id/comments', async (c) => {
  const user = c.get('user');
  const taskId = parseInt(c.req.param('id'));
  const { content } = await c.req.json<{ content: string }>();
  if (!content?.trim()) return c.json({ error: 'content required' }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO comments (id, task_id, user_id, content) VALUES (?, ?, ?, ?)'
  ).bind(id, taskId, user.id, content).run();

  const task = await getTaskWithDetail(c.env.DB, taskId);
  if (task) {
    await notifySubscribers(c.env, taskId, { type: 'comment', actor: user, task, detail: content });
  }

  return c.json({ id, ok: true }, 201);
});

tasks.post('/:id/links', async (c) => {
  const taskId = parseInt(c.req.param('id'));
  const { linked_task_id, link_type = 'related' } = await c.req.json<{
    linked_task_id: number;
    link_type?: string;
  }>();
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO task_links (task_id, linked_task_id, link_type) VALUES (?, ?, ?)'
  ).bind(taskId, linked_task_id, link_type).run();
  return c.json({ ok: true });
});

tasks.delete('/:id/links/:linkedId', async (c) => {
  const taskId = parseInt(c.req.param('id'));
  const linkedId = parseInt(c.req.param('linkedId'));
  await c.env.DB.prepare(
    'DELETE FROM task_links WHERE task_id = ? AND linked_task_id = ?'
  ).bind(taskId, linkedId).run();
  return c.json({ ok: true });
});

export default tasks;
