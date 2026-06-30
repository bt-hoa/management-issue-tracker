import type { D1Database } from '@cloudflare/workers-types';
import type { Task, Tag, Comment, Attachment, Approval, TaskLink, User } from './types';

export async function addSystemComment(
  db: D1Database,
  taskId: number,
  actor: User,
  content: string
) {
  await db.prepare(
    'INSERT INTO comments (id, task_id, user_id, content, is_system) VALUES (?, ?, ?, ?, 1)'
  ).bind(crypto.randomUUID(), taskId, actor.id, content).run();
}

export async function getTaskTags(db: D1Database, taskId: number): Promise<Tag[]> {
  const result = await db.prepare(`
    SELECT t.* FROM tags t
    JOIN task_tags tt ON tt.tag_id = t.id
    WHERE tt.task_id = ?
  `).bind(taskId).all<Tag>();
  return result.results;
}

export async function enrichTask(db: D1Database, row: Record<string, unknown>): Promise<Task> {
  const taskId = row.id as number;
  const [tags, counts] = await Promise.all([
    getTaskTags(db, taskId),
    db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM comments WHERE task_id = ?) as comment_count,
        (SELECT COUNT(*) FROM subscriptions WHERE task_id = ?) as subscriber_count
    `).bind(taskId, taskId).first<{ comment_count: number; subscriber_count: number }>(),
  ]);

  return {
    ...(row as unknown as Task),
    awaiting_board: Boolean(row.awaiting_board),
    is_recurring: Boolean(row.is_recurring),
    tags,
    comment_count: counts?.comment_count ?? 0,
    subscriber_count: counts?.subscriber_count ?? 0,
  };
}

export async function getTaskWithDetail(db: D1Database, taskId: number, viewerUserId?: string): Promise<Task | null> {
  const row = await db.prepare(`
    SELECT t.*, u.name as owner_name, u.email as owner_email
    FROM tasks t LEFT JOIN users u ON u.id = t.owner_id
    WHERE t.id = ?
  `).bind(taskId).first<Record<string, unknown>>();

  if (!row) return null;

  const [tags, comments, attachments, approvals, links, counts] = await Promise.all([
    getTaskTags(db, taskId),
    db.prepare(`
      SELECT c.*, u.name as user_name FROM comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.task_id = ? ORDER BY c.created_at ASC
    `).bind(taskId).all<Comment>(),
    db.prepare(`
      SELECT a.*, u.name as uploaded_by_name FROM attachments a
      LEFT JOIN users u ON u.id = a.uploaded_by
      WHERE a.task_id = ? ORDER BY a.created_at DESC
    `).bind(taskId).all<Attachment>(),
    db.prepare(`
      SELECT ap.*, u.name as user_name FROM approvals ap
      JOIN users u ON u.id = ap.user_id
      WHERE ap.task_id = ? ORDER BY ap.voted_at DESC
    `).bind(taskId).all<Approval>(),
    db.prepare(`
      SELECT tl.*, t2.title as linked_task_title FROM task_links tl
      JOIN tasks t2 ON t2.id = tl.linked_task_id
      WHERE tl.task_id = ?
    `).bind(taskId).all<TaskLink>(),
    db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM comments WHERE task_id = ?) as comment_count,
        (SELECT COUNT(*) FROM subscriptions WHERE task_id = ?) as subscriber_count
        ${viewerUserId ? `, (SELECT COUNT(*) FROM subscriptions WHERE task_id = ? AND user_id = ?) as is_subscribed` : ''}
    `).bind(...(viewerUserId ? [taskId, taskId, taskId, viewerUserId] : [taskId, taskId]))
      .first<{ comment_count: number; subscriber_count: number; is_subscribed?: number }>(),
  ]);

  return {
    ...(row as unknown as Task),
    awaiting_board: Boolean(row.awaiting_board),
    is_recurring: Boolean(row.is_recurring),
    tags,
    comments: comments.results.map(c => ({ ...c, is_system: Boolean(c.is_system) })),
    attachments: attachments.results,
    approvals: approvals.results,
    links: links.results,
    comment_count: counts?.comment_count ?? 0,
    subscriber_count: counts?.subscriber_count ?? 0,
    is_subscribed: Boolean(counts?.is_subscribed),
  };
}
