import { Hono } from 'hono';
import type { User } from '../types';
import type { Env } from '../env';
import { requireRole } from '../auth';
import { addSystemComment } from '../db';
import { notifySubscribers } from '../email';
import { getGoogleAccessToken } from '../google/auth';
import { getTaskWithDetail } from '../db';

const attachments = new Hono<{ Bindings: Env; Variables: { user: User } }>();

attachments.post('/:id/attachments', requireRole('board', 'management', 'vendor', 'admin'), async (c) => {
  const user = c.get('user');
  const taskId = parseInt(c.req.param('id'));

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return c.json({ error: 'No file' }, 400);

  const key = `tasks/${taskId}/${crypto.randomUUID()}/${file.name}`;
  await c.env.ATTACHMENTS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  const id = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO attachments (id, task_id, uploaded_by, filename, mime_type, size_bytes, source, r2_key)
    VALUES (?, ?, ?, ?, ?, ?, 'r2', ?)
  `).bind(id, taskId, user.id, file.name, file.type, file.size, key).run();

  await addSystemComment(c.env.DB, taskId, user, `Attached file: ${file.name}`);

  const task = await getTaskWithDetail(c.env.DB, taskId);
  if (task) {
    await notifySubscribers(c.env, taskId, { type: 'attachment', actor: user, task, detail: file.name });
  }

  return c.json({ id, filename: file.name, source: 'r2' }, 201);
});

attachments.post('/:id/attachments/drive', requireRole('board', 'management', 'vendor', 'admin'), async (c) => {
  const user = c.get('user');
  const taskId = parseInt(c.req.param('id'));
  const { drive_file_id, filename, mime_type, drive_web_view_link, drive_download_url, drive_icon_url } =
    await c.req.json<{
      drive_file_id: string;
      filename: string;
      mime_type: string;
      drive_web_view_link?: string;
      drive_download_url?: string;
      drive_icon_url?: string;
    }>();

  if (!drive_file_id || !filename) return c.json({ error: 'Missing fields' }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO attachments
      (id, task_id, uploaded_by, filename, mime_type, source,
       drive_file_id, drive_web_view_link, drive_download_url, drive_icon_url)
    VALUES (?, ?, ?, ?, ?, 'google_drive', ?, ?, ?, ?)
  `).bind(id, taskId, user.id, filename, mime_type,
    drive_file_id, drive_web_view_link ?? null, drive_download_url ?? null, drive_icon_url ?? null).run();

  await addSystemComment(c.env.DB, taskId, user, `Attached Google Drive file: ${filename}`);

  return c.json({ id, source: 'google_drive', filename, drive_web_view_link }, 201);
});

attachments.get('/:attachmentId/download', async (c) => {
  const id = c.req.param('attachmentId');
  const row = await c.env.DB.prepare(
    'SELECT * FROM attachments WHERE id = ?'
  ).bind(id).first<{ r2_key: string; filename: string; mime_type: string; source: string }>();

  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.source !== 'r2' || !row.r2_key) return c.json({ error: 'Not an R2 file' }, 400);

  const obj = await c.env.ATTACHMENTS.get(row.r2_key);
  if (!obj) return c.json({ error: 'File not found in storage' }, 404);

  return new Response(obj.body, {
    headers: {
      'Content-Type': row.mime_type,
      'Content-Disposition': `attachment; filename="${row.filename}"`,
    },
  });
});

attachments.delete('/attachments/:attachmentId', requireRole('board', 'management', 'admin'), async (c) => {
  const user = c.get('user');
  const id = c.req.param('attachmentId');
  const row = await c.env.DB.prepare(
    'SELECT * FROM attachments WHERE id = ?'
  ).bind(id).first<{ r2_key: string | null; source: string; task_id: number; filename: string }>();

  if (!row) return c.json({ error: 'Not found' }, 404);

  if (row.source === 'r2' && row.r2_key) {
    await c.env.ATTACHMENTS.delete(row.r2_key);
  }
  await c.env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(id).run();
  await addSystemComment(c.env.DB, row.task_id, user, `Removed attachment: ${row.filename}`);

  return c.json({ ok: true });
});

attachments.get('/drive/upload-url', requireRole('board', 'management', 'vendor', 'admin'), async (c) => {
  const { filename, mimeType } = c.req.query();
  if (!filename || !mimeType) return c.json({ error: 'filename and mimeType required' }, 400);

  const token = await getGoogleAccessToken(c.env);
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': mimeType,
      },
      body: JSON.stringify({ name: filename }),
    }
  );

  const uploadUrl = res.headers.get('Location');
  if (!uploadUrl) return c.json({ error: 'Could not get upload URL' }, 502);
  return c.json({ uploadUrl });
});

export default attachments;
