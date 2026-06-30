import { Hono } from 'hono';
import type { User } from '../types';
import type { Env } from '../env';
import { requireRole } from '../auth';
import { syncResidentRoster, syncAutoDetails } from '../google/sheets';

const residents = new Hono<{ Bindings: Env; Variables: { user: User } }>();

residents.get('/', requireRole('admin', 'board', 'management'), async (c) => {
  const { unit, q } = c.req.query();
  let sql = 'SELECT * FROM residents WHERE 1=1';
  const params: string[] = [];
  if (unit) { sql += ' AND unit = ?'; params.push(unit); }
  if (q)    { sql += ' AND (name LIKE ? OR unit LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY unit, name';

  const result = await c.env.DB.prepare(sql).bind(...params).all();
  const withVehicles = await Promise.all(result.results.map(async r => {
    const vehicles = await c.env.DB.prepare(
      'SELECT * FROM resident_vehicles WHERE resident_id = ?'
    ).bind((r as { id: string }).id).all();
    return { ...r, vehicles: vehicles.results };
  }));
  return c.json(withVehicles);
});

residents.get('/:id', requireRole('admin', 'board', 'management'), async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM residents WHERE id = ?')
    .bind(c.req.param('id')).first();
  if (!r) return c.json({ error: 'Not found' }, 404);
  const vehicles = await c.env.DB.prepare(
    'SELECT * FROM resident_vehicles WHERE resident_id = ?'
  ).bind((r as { id: string }).id).all();
  return c.json({ ...r, vehicles: vehicles.results });
});

residents.patch('/:id', requireRole('admin'), async (c) => {
  const body = await c.req.json<Record<string, string>>();
  const allowed = ['name', 'email', 'phone', 'resident_type', 'move_in_date', 'notes'];
  const fields = Object.keys(body).filter(k => allowed.includes(k));
  if (!fields.length) return c.json({ error: 'Nothing to update' }, 400);
  const sql = `UPDATE residents SET ${fields.map(f => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`;
  await c.env.DB.prepare(sql).bind(...fields.map(f => body[f]), c.req.param('id')).run();
  return c.json({ ok: true });
});

residents.post('/sync', requireRole('admin'), async (c) => {
  const [roster, auto] = await Promise.all([
    syncResidentRoster(c.env),
    syncAutoDetails(c.env),
  ]);
  return c.json({ roster, auto_details: auto, synced_at: new Date().toISOString() });
});

residents.get('/sync/status', requireRole('admin', 'board', 'management'), async (c) => {
  const [rosterCount, vehicleCount, lastSync] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as n FROM residents').first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as n FROM resident_vehicles').first<{ n: number }>(),
    c.env.DB.prepare('SELECT MAX(roster_synced_at) as last FROM residents').first<{ last: string | null }>(),
  ]);
  return c.json({
    residents: rosterCount?.n ?? 0,
    vehicles: vehicleCount?.n ?? 0,
    last_synced_at: lastSync?.last ?? null,
  });
});

export default residents;
