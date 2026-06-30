import { Hono } from 'hono';
import type { User, Task } from '../types';
import type { Env } from '../env';
import { requireRole } from '../auth';
import { exportToSheets } from '../google/sheets';

const admin = new Hono<{ Bindings: Env; Variables: { user: User } }>();

admin.get('/export/sheets', requireRole('admin', 'board'), async (c) => {
  const user = c.get('user');
  const includeArchived = c.req.query('include') === 'archived';

  let sql = `
    SELECT t.*, u.name as owner_name, u.email as owner_email
    FROM tasks t LEFT JOIN users u ON u.id = t.owner_id
  `;
  if (!includeArchived) sql += ' WHERE t.archived_at IS NULL';
  sql += ' ORDER BY t.id';

  const rows = await c.env.DB.prepare(sql).all<Task>();

  const tagsResult = await c.env.DB.prepare(`
    SELECT tt.task_id, t.name, t.color, t.id FROM task_tags tt JOIN tags t ON t.id = tt.tag_id
  `).all<{ task_id: number; name: string; color: string; id: string }>();

  const tagsByTask = new Map<number, { id: string; name: string; color: string }[]>();
  for (const row of tagsResult.results) {
    if (!tagsByTask.has(row.task_id)) tagsByTask.set(row.task_id, []);
    tagsByTask.get(row.task_id)!.push({ id: row.id, name: row.name, color: row.color });
  }

  const tasks = rows.results.map(t => ({
    ...t,
    tags: tagsByTask.get(t.id) ?? [],
    awaiting_board: Boolean(t.awaiting_board),
    is_recurring: Boolean(t.is_recurring),
  }));

  const sheetUrl = await exportToSheets(c.env, tasks, user.email);
  return c.json({ url: sheetUrl });
});

admin.get('/export/csv', requireRole('admin', 'board'), async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT t.*, u.name as owner_name FROM tasks t
    LEFT JOIN users u ON u.id = t.owner_id
    ORDER BY t.id
  `).all<Record<string, unknown>>();

  const headers = ['id', 'title', 'status', 'priority', 'responsibility_group',
    'owner_name', 'due_date', 'awaiting_board', 'board_direction', 'created_at', 'updated_at', 'archived_at'];

  const csv = [
    headers.join(','),
    ...rows.results.map(r =>
      headers.map(h => {
        const v = r[h];
        const s = v === null || v === undefined ? '' : String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      }).join(',')
    ),
  ].join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="hoa-tasks-${new Date().toISOString().split('T')[0]}.csv"`,
    },
  });
});

admin.get('/dashboard', async (c) => {
  const [total, overdue, awaiting, inProgress, complete] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) as n FROM tasks WHERE archived_at IS NULL`).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) as n FROM tasks WHERE status='overdue' AND archived_at IS NULL`).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) as n FROM tasks WHERE awaiting_board=1 AND archived_at IS NULL`).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) as n FROM tasks WHERE status='in_progress' AND archived_at IS NULL`).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) as n FROM tasks WHERE status='complete' AND archived_at IS NULL`).first<{ n: number }>(),
  ]);
  return c.json({ total: total?.n, overdue: overdue?.n, awaiting_board: awaiting?.n, in_progress: inProgress?.n, complete: complete?.n });
});

export default admin;
