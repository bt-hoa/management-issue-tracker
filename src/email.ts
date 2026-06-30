import type { User, Task } from './types';
import type { Env } from './env';
import { getGoogleAccessToken } from './google/auth';

export async function sendEmail(env: Env, opts: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}) {
  const token = await getGoogleAccessToken(env);
  const recipients = Array.isArray(opts.to) ? opts.to : [opts.to];

  for (const to of recipients) {
    const message = [
      `From: ${env.FROM_EMAIL}`,
      `To: ${to}`,
      `Subject: ${opts.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      opts.html,
    ].join('\r\n');

    const encoded = btoa(unescape(encodeURIComponent(message)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encoded }),
    });

    if (!res.ok) {
      console.error(`Gmail send failed to ${to}:`, await res.text());
    }
  }
}

type NotifyEvent = {
  type: 'status_change' | 'comment' | 'board_direction' | 'awaiting_board' | 'attachment' | 'assigned';
  actor: User;
  task: Task;
  detail?: string;
};

function buildSubject(event: NotifyEvent): string {
  const prefix = `[HOA Tracker] #${event.task.id} ${event.task.title}`;
  switch (event.type) {
    case 'status_change':   return `${prefix} — status changed to ${event.task.status}`;
    case 'comment':         return `${prefix} — new comment`;
    case 'board_direction': return `${prefix} — Board direction recorded`;
    case 'awaiting_board':  return `${prefix} — Awaiting Board action`;
    case 'attachment':      return `${prefix} — file attached`;
    case 'assigned':        return `${prefix} — assigned to you`;
  }
}

function buildBody(event: NotifyEvent, appUrl: string): { html: string; text: string } {
  const taskUrl = `${appUrl}/#/tasks/${event.task.id}`;
  const text = `${buildSubject(event)}\n\n${event.detail ?? ''}\n\nView task: ${taskUrl}`;
  const html = `
    <p><strong>${buildSubject(event)}</strong></p>
    ${event.detail ? `<p>${event.detail}</p>` : ''}
    <p><a href="${taskUrl}">View task #${event.task.id}</a></p>
  `.trim();
  return { html, text };
}

export async function notifySubscribers(env: Env, taskId: number, event: NotifyEvent) {
  const subs = await env.DB.prepare(`
    SELECT u.email, u.name FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE s.task_id = ? AND u.id != ? AND u.active = 1
  `).bind(taskId, event.actor.id).all<{ email: string; name: string }>();

  if (!subs.results.length) return;

  await sendEmail(env, {
    to: subs.results.map(s => s.email),
    ...buildBody(event, env.APP_URL),
    subject: buildSubject(event),
  });
}

export async function notifyBoard(env: Env, event: NotifyEvent) {
  const board = await env.DB.prepare(
    `SELECT email FROM users WHERE role IN ('board','admin') AND active = 1 AND id != ?`
  ).bind(event.actor.id).all<{ email: string }>();

  if (!board.results.length) return;

  await sendEmail(env, {
    to: board.results.map(u => u.email),
    ...buildBody(event, env.APP_URL),
    subject: buildSubject(event),
  });
}

export async function sendWeeklyDigest(env: Env) {
  const board = await env.DB.prepare(
    `SELECT email, name FROM users WHERE role IN ('board','admin') AND active = 1`
  ).all<{ email: string; name: string }>();

  if (!board.results.length) return;

  const [overdue, awaiting, inProgress] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) as n FROM tasks WHERE status='overdue' AND archived_at IS NULL`).first<{ n: number }>(),
    env.DB.prepare(`SELECT COUNT(*) as n FROM tasks WHERE awaiting_board=1 AND archived_at IS NULL`).first<{ n: number }>(),
    env.DB.prepare(`SELECT COUNT(*) as n FROM tasks WHERE status='in_progress' AND archived_at IS NULL`).first<{ n: number }>(),
  ]);

  const html = `
    <h2>HOA Tracker — Weekly Digest</h2>
    <ul>
      <li>Overdue: <strong>${overdue?.n ?? 0}</strong></li>
      <li>Awaiting Board: <strong>${awaiting?.n ?? 0}</strong></li>
      <li>In Progress: <strong>${inProgress?.n ?? 0}</strong></li>
    </ul>
    <p><a href="${env.APP_URL}">Open tracker</a></p>
  `.trim();

  const text = `HOA Tracker — Weekly Digest\n\nOverdue: ${overdue?.n ?? 0}\nAwaiting Board: ${awaiting?.n ?? 0}\nIn Progress: ${inProgress?.n ?? 0}\n\n${env.APP_URL}`;

  await sendEmail(env, {
    to: board.results.map(u => u.email),
    subject: 'HOA Tracker — Weekly Digest',
    html,
    text,
  });
}
