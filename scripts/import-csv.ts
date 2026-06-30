#!/usr/bin/env ts-node
/**
 * Reads the tracker CSV and outputs seed SQL for D1.
 * Usage: npx ts-node scripts/import-csv.ts "data/HOA Board ↔ Management Tracker - Tracker.csv" > seed.sql
 */

import * as fs from 'fs';
import * as path from 'path';
import * as Papa from 'papaparse';

const file = process.argv[2];
if (!file) { console.error('Usage: ts-node import-csv.ts <csv-file>'); process.exit(1); }

const csv = fs.readFileSync(path.resolve(file), 'utf8');
const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });

const tagIds = new Map<string, string>();
const userIds = new Map<string, string>();

function uuidLike(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h) ^ seed.charCodeAt(i);
  const hex = Math.abs(h).toString(16).padStart(8, '0');
  return `00000000-0000-0000-0000-${hex.padStart(12, '0')}`;
}

function escape(s: string | undefined | null): string {
  if (!s) return 'NULL';
  return `'${s.replace(/'/g, "''")}'`;
}

function mapStatus(s: string): string {
  const m: Record<string, string> = {
    'not started': 'not_started', 'in progress': 'in_progress',
    'overdue': 'overdue', 'complete': 'complete', 'blocked': 'blocked',
  };
  return m[s?.toLowerCase()] ?? 'not_started';
}

function mapGroup(r: string): string {
  const m: Record<string, string> = {
    'hsm': 'management', 'bod': 'board', 'joint': 'joint', 'vendor': 'vendor',
  };
  return m[r?.toLowerCase()] ?? 'management';
}

function parseDate(d: string): string | null {
  if (!d) return null;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().split('T')[0];
}

const lines: string[] = ['-- Auto-generated seed SQL', 'BEGIN TRANSACTION;', ''];

// Tags
const tagNames = new Set<string>();
for (const row of data) {
  const tag = row['Section']?.trim();
  if (tag) tagNames.add(tag);
}
for (const name of tagNames) {
  const id = uuidLike(`tag:${name}`);
  tagIds.set(name, id);
  const colors = ['#6366f1','#10b981','#f59e0b','#ef4444','#3b82f6','#8b5cf6','#ec4899'];
  const color = colors[tagIds.size % colors.length];
  lines.push(`INSERT OR IGNORE INTO tags (id, name, color) VALUES (${escape(id)}, ${escape(name)}, '${color}');`);
}
lines.push('');

// Users
const userNames = new Set<string>();
for (const row of data) {
  const name = row['Primary Contact']?.trim();
  if (name) userNames.add(name);
}
for (const name of userNames) {
  const id = uuidLike(`user:${name}`);
  userIds.set(name, id);
  const email = `${name.toLowerCase().replace(/\s+/g, '.')}@bellairetower.com`;
  lines.push(`INSERT OR IGNORE INTO users (id, email, name, role) VALUES (${escape(id)}, ${escape(email)}, ${escape(name)}, 'management');`);
}
lines.push('');

// Tasks
for (const row of data) {
  const rawId = row['ID']?.trim();
  const title = row['Title']?.trim() || row['Section']?.trim() || 'Untitled';
  const desc  = row['Description']?.trim() || null;
  const status = mapStatus(row['Status']);
  const group  = mapGroup(row['Responsibility']);
  const owner  = row['Primary Contact']?.trim();
  const ownerId = owner ? userIds.get(owner) ?? null : null;
  const dueDate = parseDate(row['Due / Target Date']);
  const awaiting = /yes/i.test(row['Awaiting BoD?'] ?? '') ? 1 : 0;
  const awaitingText = row['What HSM is waiting on BoD for']?.trim() || null;
  const direction = row['BoD Direction / Response']?.trim() || null;
  const directionDate = parseDate(row['BoD Response Date']);
  const updatedAt = parseDate(row['Last Updated']) ?? new Date().toISOString().split('T')[0];

  const idClause = rawId ? `${rawId},` : '';
  const idField  = rawId ? 'id,' : '';

  lines.push(
    `INSERT INTO tasks (${idField} title, description, status, responsibility_group, owner_id, ` +
    `due_date, awaiting_board, awaiting_board_text, board_direction, board_direction_date, updated_at) VALUES ` +
    `(${idClause} ${escape(title)}, ${escape(desc)}, '${status}', '${group}', ${escape(ownerId)}, ` +
    `${escape(dueDate)}, ${awaiting}, ${escape(awaitingText)}, ${escape(direction)}, ${escape(directionDate)}, ${escape(updatedAt)});`
  );

  if (row['Section']?.trim()) {
    const tagId = tagIds.get(row['Section'].trim());
    if (tagId && rawId) {
      lines.push(`INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (${rawId}, ${escape(tagId)});`);
    }
  }

  const notes = row['Notes / History']?.trim();
  if (notes && rawId) {
    lines.push(
      `INSERT INTO comments (id, task_id, content, is_system) VALUES ` +
      `(${escape(uuidLike(`comment:${rawId}`))}, ${rawId}, ${escape(notes)}, 1);`
    );
  }
  lines.push('');
}

lines.push('COMMIT;');
console.log(lines.join('\n'));
