import type { Task } from '../types';
import type { Env } from '../env';
import { getGoogleAccessToken } from './auth';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API  = 'https://www.googleapis.com/drive/v3/files';

export async function syncResidentRoster(env: Env): Promise<{ inserted: number; updated: number }> {
  const token = await getGoogleAccessToken(env);

  const res = await fetch(
    `${SHEETS_API}/${env.RESIDENT_ROSTER_SHEET_ID}/values/Residents!A2:G`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const { values } = await res.json<{ values?: string[][] }>();

  let inserted = 0, updated = 0;
  for (const [rowIdx, row] of (values ?? []).entries()) {
    const [unit, name, email, phone, type, move_in_date, notes] = row;
    if (!unit || !name) continue;
    const residentType = type?.toLowerCase().startsWith('tenant') ? 'tenant' : 'owner';

    const existing = await env.DB.prepare(
      'SELECT id FROM residents WHERE unit = ? AND name = ?'
    ).bind(unit.trim(), name.trim()).first<{ id: string }>();

    if (existing) {
      await env.DB.prepare(`
        UPDATE residents SET email=?, phone=?, resident_type=?, move_in_date=?,
          notes=?, roster_row=?, roster_synced_at=datetime('now'), updated_at=datetime('now')
        WHERE id=?
      `).bind(email || null, phone || null, residentType, move_in_date || null,
        notes || null, rowIdx + 2, existing.id).run();
      updated++;
    } else {
      await env.DB.prepare(`
        INSERT INTO residents (id, unit, name, email, phone, resident_type,
          move_in_date, notes, roster_row, roster_synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(crypto.randomUUID(), unit.trim(), name.trim(), email || null,
        phone || null, residentType, move_in_date || null, notes || null, rowIdx + 2).run();
      inserted++;
    }
  }
  return { inserted, updated };
}

export async function syncAutoDetails(env: Env): Promise<{ inserted: number; updated: number }> {
  const token = await getGoogleAccessToken(env);

  const res = await fetch(
    `${SHEETS_API}/${env.AUTO_DETAILS_SHEET_ID}/values/Auto Details!A2:G`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const { values } = await res.json<{ values?: string[][] }>();

  let inserted = 0, updated = 0;
  for (const [rowIdx, row] of (values ?? []).entries()) {
    const [unit, name, make, model, color, plate, spot] = row;
    if (!unit || !name) continue;

    const resident = await env.DB.prepare(
      'SELECT id FROM residents WHERE unit = ? AND name = ?'
    ).bind(unit.trim(), name.trim()).first<{ id: string }>();
    if (!resident) continue;

    const existing = await env.DB.prepare(
      'SELECT id FROM resident_vehicles WHERE resident_id = ? AND auto_details_row = ?'
    ).bind(resident.id, rowIdx + 2).first<{ id: string }>();

    if (existing) {
      await env.DB.prepare(`
        UPDATE resident_vehicles SET make=?, model=?, color=?, license_plate=?,
          parking_spot=?, synced_at=datetime('now')
        WHERE id=?
      `).bind(make || null, model || null, color || null, plate || null, spot || null, existing.id).run();
      updated++;
    } else {
      await env.DB.prepare(`
        INSERT INTO resident_vehicles
          (id, resident_id, make, model, color, license_plate, parking_spot, auto_details_row, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(crypto.randomUUID(), resident.id, make || null, model || null,
        color || null, plate || null, spot || null, rowIdx + 2).run();
      inserted++;
    }
  }
  return { inserted, updated };
}

export async function exportToSheets(env: Env, tasks: Task[], requestingUserEmail: string): Promise<string> {
  const token = await getGoogleAccessToken(env);

  const createRes = await fetch(SHEETS_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title: `HOA Task Export — ${new Date().toLocaleDateString()}` },
      sheets: [
        { properties: { title: 'Active Tasks' } },
        { properties: { title: 'Archived Tasks' } },
      ],
    }),
  });
  const { spreadsheetId, spreadsheetUrl } = await createRes.json<{
    spreadsheetId: string;
    spreadsheetUrl: string;
  }>();

  const headers = ['ID', 'Title', 'Status', 'Priority', 'Group', 'Owner',
    'Due Date', 'Awaiting Board', 'Board Direction', 'Tags', 'Est. Cost', 'Created', 'Updated'];

  const active   = tasks.filter(t => !t.archived_at);
  const archived = tasks.filter(t => t.archived_at);

  const toRow = (t: Task) => [
    t.id, t.title, t.status, t.priority, t.responsibility_group,
    t.owner_name ?? '', t.due_date ?? '',
    t.awaiting_board ? 'Yes' : 'No',
    t.board_direction ?? '',
    t.tags.map(g => g.name).join(', '),
    t.estimated_cost ?? '', t.created_at, t.updated_at,
  ];

  await Promise.all([
    fetch(`${SHEETS_API}/${spreadsheetId}/values/Active%20Tasks!A1?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [headers, ...active.map(toRow)] }),
    }),
    fetch(`${SHEETS_API}/${spreadsheetId}/values/Archived%20Tasks!A1?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [headers, ...archived.map(toRow)] }),
    }),
  ]);

  await fetch(`${DRIVE_API}/${spreadsheetId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: requestingUserEmail }),
  });

  return spreadsheetUrl;
}
