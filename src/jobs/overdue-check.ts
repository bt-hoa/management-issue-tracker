import type { Env } from '../env';
import { sendEmail } from '../email';

export async function checkOverdue(env: Env) {
  const result = await env.DB.prepare(`
    UPDATE tasks SET status = 'overdue'
    WHERE due_date < date('now')
      AND status IN ('not_started', 'in_progress')
      AND archived_at IS NULL
    RETURNING id, title, owner_id
  `).all<{ id: number; title: string; owner_id: string | null }>();

  for (const task of result.results) {
    if (!task.owner_id) continue;
    const owner = await env.DB.prepare('SELECT email, name FROM users WHERE id = ?')
      .bind(task.owner_id).first<{ email: string; name: string }>();
    if (!owner) continue;

    await sendEmail(env, {
      to: owner.email,
      subject: `[HOA Tracker] Task #${task.id} is now overdue`,
      text: `Task #${task.id} "${task.title}" is past its due date.\n\n${env.APP_URL}/#/tasks/${task.id}`,
      html: `<p>Task <strong>#${task.id} "${task.title}"</strong> is past its due date.</p><p><a href="${env.APP_URL}/#/tasks/${task.id}">View task</a></p>`,
    });
  }
}
