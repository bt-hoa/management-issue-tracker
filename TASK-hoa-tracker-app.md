# TASK: Bellaire Tower HOA Task Tracker — Cloudflare Workers App

## Context

Build a purpose-built task and communication tracker for the Bellaire Tower HOA Board of Directors and their management company (HSM). This replaces a Google Sheets workflow. See `HOA_TRACKER_DESIGN.md` for full product design.

**Deployment target:** Cloudflare Workers + D1 + R2 + KV  
**Domain:** `tracker.bellairetower.com` (or configure in wrangler.toml)  
**Auth:** Cloudflare Access (Google OAuth) — Access is configured at the Cloudflare dashboard level, Workers receives a validated JWT; no auth code needed in the app beyond JWT verification  
**Email:** Resend API (set `RESEND_API_KEY` in wrangler secrets)  
**File attachments:** Dual-source — direct upload to Cloudflare R2 (photos, quick uploads) OR link/upload to Google Drive (documents, reports, shared files)  
**Cloudflare cost note:** Free tier is sufficient at any realistic task volume. The only anticipated spend is Workers Paid ($5/month) if CPU time exceeds 10ms on complex FTS queries. R2 usage is minimal given Google Drive handles most document storage.

---

## Repo Structure

```
hoa-tracker/
├── wrangler.toml
├── package.json
├── tsconfig.json
├── schema.sql              # D1 schema — run once via wrangler d1 execute
├── seed.sql                # Optional: initial tags and admin user
├── src/
│   ├── worker.ts           # Main Workers entry point (Hono app + Cron)
│   ├── db.ts               # D1 query helpers
│   ├── auth.ts             # Cloudflare Access JWT verification
│   ├── email.ts            # Resend email sender
│   ├── routes/
│   │   ├── tasks.ts        # Task CRUD routes
│   │   ├── comments.ts     # Comment routes
│   │   ├── tags.ts         # Tag management routes
│   │   ├── users.ts        # User management routes
│   │   ├── residents.ts    # Resident roster + vehicle routes
│   │   ├── attachments.ts  # R2 upload/download routes
│   │   └── admin.ts        # Import, settings routes
│   ├── jobs/
│   │   ├── weekly-digest.ts
│   │   └── overdue-check.ts
│   └── types.ts            # Shared TypeScript types
├── frontend/
│   ├── index.html
│   ├── src/
│   │   ├── main.ts         # App entry point, router
│   │   ├── api.ts          # Typed fetch wrapper for all API calls
│   │   ├── auth.ts         # Role detection from CF-Access headers
│   │   ├── store.ts        # Simple reactive state (no framework needed)
│   │   ├── views/
│   │   │   ├── TaskList.ts
│   │   │   ├── TaskDetail.ts
│   │   │   ├── Archive.ts
│   │   │   ├── NewTask.ts
│   │   │   └── Settings.ts
│   │   ├── components/
│   │   │   ├── TaskRow.ts
│   │   │   ├── StatusBadge.ts
│   │   │   ├── TagChip.ts
│   │   │   ├── CommentThread.ts
│   │   │   ├── FilterSidebar.ts
│   │   │   ├── SortBar.ts
│   │   │   ├── MetadataSidebar.ts
│   │   │   ├── ApprovalWidget.ts
│   │   │   └── Modal.ts
│   │   ├── styles/
│   │   │   ├── base.css
│   │   │   ├── layout.css
│   │   │   ├── components.css
│   │   │   └── tokens.css
│   │   └── google/
│   │       ├── drive-picker.ts   # Google Picker API wrapper
│   │       ├── drive-upload.ts   # Client-side Drive upload helper
│   │       └── sheets-export.ts  # Google Sheets export helper
│   └── vite.config.ts
└── scripts/
    ├── import-csv.ts                  # Migration helper: reads tracker CSV → seed SQL
    └── create-auto-details-sheet.ts   # One-time: creates Auto Details Google Sheet template
```

---

## wrangler.toml

```toml
name = "hoa-tracker"
main = "src/worker.ts"
compatibility_date = "2024-01-01"

[site]
bucket = "./frontend/dist"

[[d1_databases]]
binding = "DB"
database_name = "hoa-tracker"
database_id = ""   # fill after `wrangler d1 create hoa-tracker`

[[kv_namespaces]]
binding = "SESSIONS"
id = ""            # fill after `wrangler kv:namespace create SESSIONS`

[[r2_buckets]]
binding = "ATTACHMENTS"
bucket_name = "hoa-tracker-attachments"

[triggers]
crons = ["0 8 * * 5", "0 6 * * *"]   # Friday 8am digest; daily 6am overdue check

[vars]
# Public Google OAuth client ID — safe to commit; secret is set via wrangler secret
GOOGLE_CLIENT_ID = ""    # fill from Google Cloud Console
```

---

## Database Schema (`schema.sql`)

```sql
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,          -- UUID
  email      TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'management',
                                        -- 'admin'|'board'|'management'|'vendor'|'resident'
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  title                TEXT NOT NULL,
  description          TEXT,
  status               TEXT NOT NULL DEFAULT 'not_started',
                                        -- 'not_started'|'in_progress'|'overdue'|'blocked'|'complete'
  priority             TEXT NOT NULL DEFAULT 'normal',
                                        -- 'urgent'|'high'|'normal'|'low'
  responsibility_group TEXT NOT NULL DEFAULT 'management',
                                        -- 'board'|'management'|'vendor'|'joint'|'individual'
  owner_id             TEXT REFERENCES users(id),
  due_date             TEXT,
  awaiting_board       INTEGER NOT NULL DEFAULT 0,
  awaiting_board_text  TEXT,
  board_direction      TEXT,
  board_direction_date TEXT,
  board_direction_by   TEXT REFERENCES users(id),
  estimated_cost       REAL,
  approved_budget      REAL,
  is_recurring         INTEGER NOT NULL DEFAULT 0,
  recurrence_rule      TEXT,            -- 'weekly'|'monthly' etc.
  archived_at          TEXT,
  created_by           TEXT REFERENCES users(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
  id    TEXT PRIMARY KEY,               -- UUID
  name  TEXT UNIQUE NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1'
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT    REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,          -- UUID
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    TEXT    REFERENCES users(id),
  content    TEXT NOT NULL,
  is_system  INTEGER NOT NULL DEFAULT 0,  -- 1 = automated audit entry
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Mentions extracted from comments for targeted notification
CREATE TABLE IF NOT EXISTS mentions (
  comment_id TEXT    NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    TEXT    NOT NULL REFERENCES users(id),
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT    NOT NULL REFERENCES users(id),
  PRIMARY KEY (task_id, user_id)
);

-- Task-to-task relationships
CREATE TABLE IF NOT EXISTS task_links (
  task_id         INTEGER NOT NULL REFERENCES tasks(id),
  linked_task_id  INTEGER NOT NULL REFERENCES tasks(id),
  link_type       TEXT NOT NULL DEFAULT 'related',  -- 'related'|'blocks'|'blocked_by'
  PRIMARY KEY (task_id, linked_task_id)
);

-- Approval/vote records
CREATE TABLE IF NOT EXISTS approvals (
  id         TEXT PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id),
  user_id    TEXT    NOT NULL REFERENCES users(id),
  vote       TEXT    NOT NULL,           -- 'approve'|'decline'
  note       TEXT,
  voted_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Stores attachment metadata; files live in R2 or Google Drive
CREATE TABLE IF NOT EXISTS attachments (
  id                  TEXT PRIMARY KEY,
  task_id             INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by         TEXT    REFERENCES users(id),
  filename            TEXT NOT NULL,
  mime_type           TEXT NOT NULL,
  size_bytes          INTEGER,
  source              TEXT NOT NULL DEFAULT 'r2',  -- 'r2' | 'google_drive'
  -- R2 fields (source = 'r2')
  r2_key              TEXT UNIQUE,
  -- Google Drive fields (source = 'google_drive')
  drive_file_id       TEXT UNIQUE,
  drive_web_view_link TEXT,         -- open-in-browser URL
  drive_download_url  TEXT,         -- direct download URL
  drive_icon_url      TEXT,         -- Drive file type icon
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Residents — imported from two Google Sheets (Roster + Auto Details)
CREATE TABLE IF NOT EXISTS residents (
  id               TEXT PRIMARY KEY,             -- UUID
  unit             TEXT NOT NULL,                -- e.g. '801', '1203'
  name             TEXT NOT NULL,
  email            TEXT,
  phone            TEXT,
  resident_type    TEXT NOT NULL DEFAULT 'owner', -- 'owner'|'tenant'
  move_in_date     TEXT,
  notes            TEXT,
  roster_row       INTEGER,                       -- row number in Roster Sheet (for delta sync)
  roster_synced_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resident_vehicles (
  id                TEXT PRIMARY KEY,            -- UUID
  resident_id       TEXT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  make              TEXT,
  model             TEXT,
  color             TEXT,
  license_plate     TEXT,
  parking_spot      TEXT,                        -- e.g. 'B-12', 'Street'
  auto_details_row  INTEGER,                      -- row number in Auto Details Sheet
  synced_at         TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_residents_unit     ON residents(unit);
CREATE INDEX IF NOT EXISTS idx_vehicles_resident  ON resident_vehicles(resident_id);

-- Indices
CREATE INDEX IF NOT EXISTS idx_tasks_status       ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_owner        ON tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_tasks_archived     ON tasks(archived_at);
CREATE INDEX IF NOT EXISTS idx_tasks_awaiting     ON tasks(awaiting_board);
CREATE INDEX IF NOT EXISTS idx_comments_task      ON comments(task_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_task     ON task_tags(task_id);

-- Full-text search virtual table (D1 supports fts5)
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
  title, description, board_direction, content=tasks, content_rowid=id
);

CREATE TRIGGER IF NOT EXISTS tasks_fts_insert AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, title, description, board_direction)
  VALUES (new.id, new.title, new.description, new.board_direction);
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_update AFTER UPDATE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description, board_direction)
  VALUES ('delete', old.id, old.title, old.description, old.board_direction);
  INSERT INTO tasks_fts(rowid, title, description, board_direction)
  VALUES (new.id, new.title, new.description, new.board_direction);
END;

CREATE TRIGGER IF NOT EXISTS tasks_updated_at AFTER UPDATE ON tasks BEGIN
  UPDATE tasks SET updated_at = datetime('now') WHERE id = new.id;
END;
```

---

## TypeScript Types (`src/types.ts`)

```typescript
export type Role = 'admin' | 'board' | 'management' | 'vendor' | 'resident';
export type Status = 'not_started' | 'in_progress' | 'overdue' | 'blocked' | 'complete';
export type Priority = 'urgent' | 'high' | 'normal' | 'low';
export type ResponsibilityGroup = 'board' | 'management' | 'vendor' | 'joint' | 'individual';
export type LinkType = 'related' | 'blocks' | 'blocked_by';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  created_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export type AttachmentSource = 'r2' | 'google_drive';

export interface Attachment {
  id: string;
  task_id: number;
  uploaded_by: string;
  uploaded_by_name: string;
  filename: string;
  mime_type: string;
  size_bytes: number | null;
  source: AttachmentSource;
  // R2 — populated when source = 'r2'
  url?: string;               // presigned R2 URL, generated at serve time
  // Google Drive — populated when source = 'google_drive'
  drive_file_id?: string;
  drive_web_view_link?: string;
  drive_download_url?: string;
  drive_icon_url?: string;
  created_at: string;
}

export interface Comment {
  id: string;
  task_id: number;
  user_id: string | null;
  user_name: string | null;
  content: string;
  is_system: boolean;
  created_at: string;
}

export interface Approval {
  id: string;
  task_id: number;
  user_id: string;
  user_name: string;
  vote: 'approve' | 'decline';
  note: string | null;
  voted_at: string;
}

export interface TaskLink {
  task_id: number;
  linked_task_id: number;
  linked_task_title: string;
  link_type: LinkType;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  responsibility_group: ResponsibilityGroup;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  due_date: string | null;
  awaiting_board: boolean;
  awaiting_board_text: string | null;
  board_direction: string | null;
  board_direction_date: string | null;
  board_direction_by: string | null;
  estimated_cost: number | null;
  approved_budget: number | null;
  is_recurring: boolean;
  recurrence_rule: string | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  tags: Tag[];
  comment_count: number;
  unread_count?: number;     // for current viewer
  subscriber_count: number;
  is_subscribed?: boolean;   // for current viewer
  attachments?: Attachment[];
  comments?: Comment[];
  links?: TaskLink[];
  approvals?: Approval[];
}

export type ResidentType = 'owner' | 'tenant';

export interface ResidentVehicle {
  id: string;
  resident_id: string;
  make: string | null;
  model: string | null;
  color: string | null;
  license_plate: string | null;
  parking_spot: string | null;
  synced_at: string | null;
  created_at: string;
}

export interface Resident {
  id: string;
  unit: string;
  name: string;
  email: string | null;
  phone: string | null;
  resident_type: ResidentType;
  move_in_date: string | null;
  notes: string | null;
  roster_synced_at: string | null;
  created_at: string;
  updated_at: string;
  vehicles: ResidentVehicle[];
}

// Bindings available in Workers env
export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  ATTACHMENTS: R2Bucket;
  RESEND_API_KEY: string;
  CF_ACCESS_AUD: string;        // Cloudflare Access audience tag
  CF_TEAM_DOMAIN: string;       // your-team.cloudflareaccess.com
  FROM_EMAIL: string;           // e.g. tracker@bellairetower.com
  APP_URL: string;              // e.g. https://tracker.bellairetower.com
  // Google — GOOGLE_CLIENT_ID is a [var] (public); others are secrets
  GOOGLE_CLIENT_ID: string;          // OAuth client ID, safe to expose to frontend
  GOOGLE_CLIENT_SECRET: string;      // Secret — used server-side only for Sheets OAuth
  GOOGLE_SA_PRIVATE_KEY: string;     // Service account private key (PEM) for Sheets API
  GOOGLE_SA_EMAIL: string;           // Service account email
  // Resident roster Google Sheets (IDs from sheet URL)
  RESIDENT_ROSTER_SHEET_ID: string;  // Master resident roster sheet
  AUTO_DETAILS_SHEET_ID: string;     // Vehicle / auto details sheet
}
```

---

## API Routes (`src/routes/tasks.ts`)

Implement all routes under `/api/tasks` using Hono. Every mutating route should:
1. Verify the user's role permits the action
2. Write the change to D1
3. Write a system comment to the `comments` table describing the change
4. Call `notifySubscribers()` from `email.ts` if applicable
5. Return the updated task

```
GET    /api/tasks                    List tasks (active, filtered, sorted per query params)
GET    /api/tasks/archive            List archived tasks (with q= full-text search)
POST   /api/tasks                    Create task
GET    /api/tasks/:id                Get single task with full detail
PATCH  /api/tasks/:id                Update task fields
DELETE /api/tasks/:id/archive        Archive task (Board/Admin only)
POST   /api/tasks/:id/restore        Restore from archive (Board/Admin only)
GET    /api/tasks/:id/comments       Get comments for task
POST   /api/tasks/:id/comments       Add comment
POST   /api/tasks/:id/subscribe      Subscribe current user
DELETE /api/tasks/:id/subscribe      Unsubscribe current user
POST   /api/tasks/:id/approve        Record approval vote (Board only)
POST   /api/tasks/:id/links          Add task link
DELETE /api/tasks/:id/links/:linkId  Remove task link
POST   /api/tasks/:id/attachments    Upload file → R2; record in DB
DELETE /api/tasks/:id/attachments/:attachmentId
POST   /api/tasks/:id/attachments/drive  # Link or upload a Google Drive file (see Drive section)

GET    /api/drive/upload-url             # Returns a Drive resumable upload URL (client then uploads directly)
GET    /api/drive/files?q=               # Proxy search of user's Drive (uses per-user token from KV)

GET    /api/export/sheets                # Export all archived tasks to a new Google Sheet (Admin/Board)
GET    /api/export/csv                   # Export all tasks as CSV download

GET    /api/tags                     List all tags
POST   /api/tags                     Create tag (Admin/Board)
PATCH  /api/tags/:id                 Rename/recolor (Admin)
POST   /api/tags/:id/merge/:targetId Merge two tags (Admin)
DELETE /api/tags/:id                 Delete tag (Admin)

GET    /api/users                    List users (Admin/Board)
POST   /api/users/invite             Send invite email (Admin)
PATCH  /api/users/:id                Edit role/name (Admin)

GET    /api/residents                List residents (with unit + vehicle data)
GET    /api/residents/:id            Get single resident with vehicles
PATCH  /api/residents/:id            Manual edit (Admin only — overrides imported data)
POST   /api/residents/sync           Trigger sync from both Google Sheets (Admin only)
GET    /api/residents/sync/status    Last sync timestamp + row counts for both sheets

GET    /api/me                       Current user info + role
GET    /api/dashboard                Board dashboard summary counts
POST   /api/agenda                   Generate meeting agenda (returns markdown)
POST   /api/admin/import             CSV import (Admin only)
```

---

## Smart Sort Implementation (`src/routes/tasks.ts`)

The list query accepts `sort=smart|due_date|priority|updated|group|owner`. For `sort=smart`, apply this logic server-side using a computed `sort_score`:

```typescript
function computeSortScore(task: Task, viewerRole: Role, viewerUserId: string): number {
  let score = 0;

  // Status weights
  const statusWeight: Record<Status, number> = {
    overdue:     1000,
    blocked:      800,
    in_progress:  400,
    not_started:  200,
    complete:       0,
  };
  score += statusWeight[task.status] ?? 0;

  // Priority weights
  const priorityWeight: Record<Priority, number> = {
    urgent: 500,
    high:   300,
    normal: 100,
    low:      0,
  };
  score += priorityWeight[task.priority] ?? 0;

  // Board-specific: awaiting board bumped to top
  if (viewerRole === 'board' && task.awaiting_board) score += 900;

  // Management-specific: own tasks surfaced
  if (viewerRole === 'management' && task.owner_id === viewerUserId) score += 600;

  // Due-date urgency: tasks due within 7 days get a boost
  if (task.due_date) {
    const daysUntilDue = (new Date(task.due_date).getTime() - Date.now()) / 86400000;
    if (daysUntilDue < 0)  score += 400;   // overdue by date (belt + suspenders with status)
    else if (daysUntilDue <= 3)  score += 350;
    else if (daysUntilDue <= 7)  score += 200;
    else if (daysUntilDue <= 14) score += 100;
  }

  return score;
}
```

Return tasks ordered by `sort_score DESC`, then `updated_at DESC` as tiebreaker.

---

## Auth (`src/auth.ts`)

Cloudflare Access validates the JWT before the request reaches Workers. Verify it and extract the user:

```typescript
import { Hono } from 'hono';

export async function getUser(request: Request, env: Env): Promise<User | null> {
  // Cloudflare Access sets CF-Access-Jwt-Assertion header
  const jwt = request.headers.get('CF-Access-Jwt-Assertion');
  if (!jwt) return null;

  // Verify against the Cloudflare Access JWKS endpoint
  const certsUrl = `https://${env.CF_TEAM_DOMAIN}/cdn-cgi/access/certs`;
  // ... standard JWT verification using the JWKS ...
  // Extract email from payload, look up or create user in DB
  const email = payload.email as string;
  let user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
  if (!user && payload.email) {
    // First-time login: create user with default role 'management'
    // Admin must promote to correct role in Settings
    user = await createUser(env.DB, email, payload.name ?? email);
  }
  return user;
}

// Middleware factory for role checks
export function requireRole(...roles: Role[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as User;
    if (!roles.includes(user.role)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    await next();
  };
}
```

---

## Email (`src/email.ts`)

```typescript
const RESEND_API = 'https://api.resend.com/emails';

export async function sendEmail(env: Env, opts: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}) {
  await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: Array.isArray(opts.to) ? opts.to : [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
}

export async function notifySubscribers(env: Env, taskId: number, event: {
  type: 'status_change' | 'comment' | 'board_direction' | 'awaiting_board' | 'attachment' | 'assigned';
  actor: User;
  task: Task;
  detail?: string;
}) {
  // Fetch all subscriber emails for this task
  const subs = await env.DB.prepare(`
    SELECT u.email, u.name FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE s.task_id = ? AND u.id != ? AND u.active = 1
  `).bind(taskId, event.actor.id).all<{email: string; name: string}>();

  if (!subs.results.length) return;

  const subject = buildSubject(event);
  const { html, text } = buildBody(event, env.APP_URL);

  await sendEmail(env, {
    to: subs.results.map(s => s.email),
    subject,
    html,
    text,
  });
}

// Also: notifyBoard(), notifyOwner(), sendWeeklyDigest(), sendMention()
```

---

## Cron Handler (`src/jobs/`)

In `src/worker.ts`:

```typescript
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const { cron } = event;
    if (cron === '0 8 * * 5') {
      // Friday 8am — weekly digest to all Board members
      await sendWeeklyDigest(env);
    } else if (cron === '0 6 * * *') {
      // Daily 6am — mark tasks as overdue if due_date has passed
      await checkOverdue(env);
    }
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  }
};
```

`checkOverdue`: UPDATE tasks SET status = 'overdue' WHERE due_date < date('now') AND status IN ('not_started', 'in_progress') AND archived_at IS NULL; then notify owners of newly-overdue tasks.

---

## Frontend Architecture

Vanilla TypeScript SPA — no framework. Hono serves the `frontend/dist/` static assets via `[site]` binding. All data via `/api/*`.

### Router (`src/main.ts`)
Simple hash-based router:
```
#/          → TaskList view
#/tasks/new → NewTask view  
#/tasks/:id → TaskDetail view
#/archive   → Archive view
#/settings  → Settings view (Admin/Board only)
```

### State (`src/store.ts`)
Minimal reactive store — a single `AppState` object with typed fields; views subscribe to changes via a simple EventEmitter. No framework, no virtual DOM.

```typescript
interface AppState {
  currentUser: User | null;
  tasks: Task[];
  tags: Tag[];
  users: User[];
  filters: FilterState;
  sortMode: SortMode;
  isLoading: boolean;
  error: string | null;
}
```

### Component Pattern
Each component is a class with:
- `render(): HTMLElement` — builds DOM, attaches event listeners
- `update(data)` — mutates DOM for partial updates (no full re-render)
- `destroy()` — cleanup listeners

---

## UI Design Spec

### Design Tokens (`styles/tokens.css`)

```css
:root {
  /* Palette — dark sidebar, light content */
  --color-sidebar-bg:      #1a1d23;
  --color-sidebar-text:    #9ca3af;
  --color-sidebar-active:  #ffffff;
  --color-sidebar-hover:   #2d3139;
  --color-content-bg:      #f9fafb;
  --color-content-surface: #ffffff;
  --color-border:          #e5e7eb;

  /* Status */
  --color-overdue:         #ef4444;
  --color-overdue-bg:      #fef2f2;
  --color-awaiting:        #f59e0b;
  --color-awaiting-bg:     #fffbeb;
  --color-inprogress:      #3b82f6;
  --color-inprogress-bg:   #eff6ff;
  --color-complete:        #10b981;
  --color-complete-bg:     #ecfdf5;
  --color-blocked:         #8b5cf6;
  --color-blocked-bg:      #f5f3ff;

  /* Priority indicators */
  --color-urgent:          #dc2626;
  --color-high:            #ea580c;
  --color-normal:          #6b7280;
  --color-low:             #d1d5db;

  /* Typography */
  --font-ui:               'DM Sans', system-ui, sans-serif;
  --font-mono:             'JetBrains Mono', 'Fira Code', monospace;
  --font-size-sm:          0.75rem;
  --font-size-base:        0.875rem;
  --font-size-lg:          1rem;
  --font-size-xl:          1.25rem;

  /* Spacing */
  --radius-sm:   4px;
  --radius-md:   8px;
  --radius-lg:   12px;
  --shadow-sm:   0 1px 3px rgba(0,0,0,0.08);
  --shadow-md:   0 4px 12px rgba(0,0,0,0.12);
}
```

### Layout

```
┌─────────────┬───────────────────────────────────────────────┐
│  SIDEBAR    │  HEADER (app name, search, user avatar, bell) │
│  180px      ├───────────────────────────────────────────────┤
│             │  SORT BAR (Smart | Due Date | Priority | ...)  │
│  Nav items  ├───────────────────────────────────────────────┤
│  ─────────  │                                               │
│  Filters    │  TASK LIST                                    │
│             │  (rows, infinite scroll)                      │
│  Tags       │                                               │
│             │                                               │
│  ─────────  │                                               │
│  My tasks   │                                               │
└─────────────┴───────────────────────────────────────────────┘
```

On mobile: sidebar collapses to a bottom navigation bar. Task detail opens full-screen.

### Task Row

```
┌──────────────────────────────────────────────────────────────┐
│ ●  #22  Elevator #2 — door operator investigation      🔴    │
│    [Management] Robin  ·  Jun 4  ·  #facilities #elevator    │
│    ⚠ Awaiting Board: Authorize alternate bid?   💬 3  📎 1   │
└──────────────────────────────────────────────────────────────┘
```

- Left: priority dot (urgent=red, high=orange, normal=gray, low=light)
- ID in monospace
- Status badge right-aligned
- Second line: group badge, owner name, due date, first N tags
- Third line (if present): awaiting-board excerpt; comment count; attachment count

### Task Detail — layout

Two-column on desktop, single-column stack on mobile.

**Left column (flex: 1):**
- Title (h1, editable for Board)
- Description (rich text, rendered markdown)
- If `awaiting_board`: amber banner "⚠ Awaiting Board — [awaiting_board_text]"
- If `board_direction`: green panel "✓ Board Direction (date, by name) — [text]"
- If task requires approval: `ApprovalWidget` showing vote count, individual votes, and Approve/Decline buttons
- Comment / Activity thread

**Right column (280px):**
- Status dropdown
- Priority dropdown
- Responsibility Group dropdown
- Owner picker (search users)
- Due date
- Estimated Cost / Budget (if set)
- Tags multiselect
- Linked Tasks
- Subscribers (avatars + Subscribe/Unsubscribe)
- Attachments list (thumbnails for images)
- Created/Updated meta

### Filter Sidebar (desktop only, collapsible)

```
Status
  ☑ Not Started
  ☑ In Progress
  ☑ Overdue
  ☑ Blocked
  ☐ Complete

Priority
  ☑ Urgent
  ☑ High
  ☑ Normal
  ☑ Low

Group
  ☑ Board
  ☑ Management
  ☑ Vendor
  ☑ Joint

Owner
  [search users...]

Tags
  legal (3)
  financial (4)
  facilities (9)
  ...

─────────────
☐ Awaiting Board only
☐ My tasks only
☐ Include archived
```

---

## CSV Import Script (`scripts/import-csv.ts`)

Run via `npx ts-node scripts/import-csv.ts "data/HOA Board ↔ Management Tracker - Tracker.csv" > seed.sql`

Map columns:
- `ID` → `tasks.id` (kept as-is for continuity)
- `Section` → create tag with that name; assign to task
- `Title` → `tasks.title`
- `Description` → `tasks.description`
- `Responsibility` → `tasks.responsibility_group` (map: HSM→management, BoD→board, Joint→joint)
- `Primary Contact` → look up or create user, set as `tasks.owner_id`
- `Status` → map to enum (Not Started→not_started, In Progress→in_progress, Overdue→overdue, Complete→complete)
- `Due / Target Date` → `tasks.due_date` (parse to ISO date where possible; store as note otherwise)
- `Awaiting BoD?` → `tasks.awaiting_board` (Yes→1, No→0)
- `What HSM is waiting on BoD for` → `tasks.awaiting_board_text`
- `BoD Direction / Response` → `tasks.board_direction`
- `BoD Response Date` → `tasks.board_direction_date`
- `Notes / History` → insert as first comment with `is_system=1`
- `Last Updated` → `tasks.updated_at`
- `Updated By` → attempt user lookup; fall back to comment attribution

---

## Resident Roster — Google Sheets Sync (`src/routes/residents.ts`)

Two sheets feed resident data into D1. Both are read using the service account (same credentials used for Sheets export). The sync is upsert-based — rows are matched by unit+name; new rows insert, changed rows update, missing rows are left alone (not deleted, in case of a temporary Sheet gap).

### Roster Sheet — expected column layout

| Column | Field |
|--------|-------|
| A | Unit # (e.g. `801`) |
| B | Resident Name |
| C | Email |
| D | Phone |
| E | Owner or Tenant (`Owner` / `Tenant`) |
| F | Move-in Date |
| G | Notes |

Row 1 is the header row (skipped during import). The sheet name is `Residents`.

### Auto Details Sheet — template column layout

The Auto Details sheet is new and created by `scripts/create-auto-details-sheet.ts`. Column layout:

| Column | Field |
|--------|-------|
| A | Unit # |
| B | Resident Name |
| C | Vehicle Make |
| D | Vehicle Model |
| E | Vehicle Color |
| F | License Plate |
| G | Parking Spot |

Row 1 is the header row. The sheet name is `Auto Details`. One resident may appear on multiple rows if they have multiple vehicles.

### Sync implementation (`src/google/sheets-sync.ts`)

```typescript
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

export async function syncResidentRoster(env: Env): Promise<{ inserted: number; updated: number }> {
  const token = await getServiceAccountToken(env, [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
  ]);

  const res = await fetch(
    `${SHEETS_API}/${env.RESIDENT_ROSTER_SHEET_ID}/values/Residents!A2:G`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const { values } = await res.json<{ values: string[][] }>();

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
      `).bind(email||null, phone||null, residentType, move_in_date||null,
               notes||null, rowIdx + 2, existing.id).run();
      updated++;
    } else {
      await env.DB.prepare(`
        INSERT INTO residents (id, unit, name, email, phone, resident_type,
          move_in_date, notes, roster_row, roster_synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(crypto.randomUUID(), unit.trim(), name.trim(), email||null,
               phone||null, residentType, move_in_date||null, notes||null, rowIdx + 2).run();
      inserted++;
    }
  }
  return { inserted, updated };
}

export async function syncAutoDetails(env: Env): Promise<{ inserted: number; updated: number }> {
  const token = await getServiceAccountToken(env, [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
  ]);

  const res = await fetch(
    `${SHEETS_API}/${env.AUTO_DETAILS_SHEET_ID}/values/Auto Details!A2:G`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const { values } = await res.json<{ values: string[][] }>();

  let inserted = 0, updated = 0;
  for (const [rowIdx, row] of (values ?? []).entries()) {
    const [unit, name, make, model, color, plate, spot] = row;
    if (!unit || !name) continue;

    // Look up resident by unit + name
    const resident = await env.DB.prepare(
      'SELECT id FROM residents WHERE unit = ? AND name = ?'
    ).bind(unit.trim(), name.trim()).first<{ id: string }>();
    if (!resident) continue;  // skip if resident not yet in roster

    const existing = await env.DB.prepare(
      'SELECT id FROM resident_vehicles WHERE resident_id = ? AND auto_details_row = ?'
    ).bind(resident.id, rowIdx + 2).first<{ id: string }>();

    if (existing) {
      await env.DB.prepare(`
        UPDATE resident_vehicles SET make=?, model=?, color=?, license_plate=?,
          parking_spot=?, synced_at=datetime('now')
        WHERE id=?
      `).bind(make||null, model||null, color||null, plate||null, spot||null, existing.id).run();
      updated++;
    } else {
      await env.DB.prepare(`
        INSERT INTO resident_vehicles
          (id, resident_id, make, model, color, license_plate, parking_spot, auto_details_row, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(crypto.randomUUID(), resident.id, make||null, model||null,
               color||null, plate||null, spot||null, rowIdx + 2).run();
      inserted++;
    }
  }
  return { inserted, updated };
}
```

### POST /api/residents/sync route

```typescript
app.post('/api/residents/sync', requireRole('admin'), async (c) => {
  const [rosterResult, autoResult] = await Promise.all([
    syncResidentRoster(c.env),
    syncAutoDetails(c.env),
  ]);
  return c.json({
    roster: rosterResult,
    auto_details: autoResult,
    synced_at: new Date().toISOString(),
  });
});
```

### Cron integration

Add to `src/worker.ts` scheduled handler:

```typescript
} else if (cron === '0 6 * * *') {
  await checkOverdue(env);
  // Also sync residents on the daily run
  await Promise.all([syncResidentRoster(env), syncAutoDetails(env)]);
}
```

### Creating the Auto Details Sheet (`scripts/create-auto-details-sheet.ts`)

Run once to create the template sheet and print its ID:

```typescript
// npx ts-node scripts/create-auto-details-sheet.ts
import { getServiceAccountToken } from '../src/google/sheets-sync';

async function main() {
  const token = await getServiceAccountToken(env, [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ]);

  // Create sheet
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title: 'Bellaire Tower — Resident Auto Details' },
      sheets: [{ properties: { title: 'Auto Details' } }],
    }),
  });
  const { spreadsheetId, spreadsheetUrl } = await res.json();

  // Write headers
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Auto Details!A1:G1?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: [['Unit #', 'Resident Name', 'Vehicle Make', 'Vehicle Model',
                   'Vehicle Color', 'License Plate', 'Parking Spot']],
      }),
    }
  );

  // Share with admin
  await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: 'paul@palindrome.com' }),
  });

  console.log(`Sheet URL: ${spreadsheetUrl}`);
  console.log(`Sheet ID (store as AUTO_DETAILS_SHEET_ID secret): ${spreadsheetId}`);
}
main();
```

---

## Deployment Steps

```bash
# 1. Install
npm install

# 2. Create D1 database
wrangler d1 create hoa-tracker
# Copy database_id into wrangler.toml

# 3. Run schema
wrangler d1 execute hoa-tracker --file=schema.sql

# 4. Create KV namespace
wrangler kv:namespace create SESSIONS
# Copy id into wrangler.toml

# 5. Create R2 bucket
wrangler r2 bucket create hoa-tracker-attachments

# 6. Set secrets
wrangler secret put RESEND_API_KEY
wrangler secret put CF_ACCESS_AUD       # from Cloudflare Access app settings
wrangler secret put CF_TEAM_DOMAIN      # your-team.cloudflareaccess.com
wrangler secret put FROM_EMAIL
wrangler secret put APP_URL
wrangler secret put GOOGLE_CLIENT_SECRET    # from Google Cloud Console OAuth credentials
wrangler secret put GOOGLE_SA_PRIVATE_KEY  # from service account JSON key file
wrangler secret put GOOGLE_SA_EMAIL        # from service account JSON (client_email field)
wrangler secret put RESIDENT_ROSTER_SHEET_ID  # from roster sheet URL
wrangler secret put AUTO_DETAILS_SHEET_ID     # from auto details sheet URL (after running create-auto-details-sheet.ts)
# Add to wrangler.toml [vars] (public, safe to expose):
#   GOOGLE_CLIENT_ID = "..."           # OAuth client ID
#   GOOGLE_PICKER_API_KEY = "..."      # Picker API key (HTTP-referrer restricted)

# 7. Build frontend
cd frontend && npm install && npm run build && cd ..

# 8. Deploy
wrangler deploy

# 9. Import existing task data (optional)
npx ts-node scripts/import-csv.ts "data/HOA Board ↔ Management Tracker - Tracker.csv" > seed.sql
wrangler d1 execute hoa-tracker --file=seed.sql

# 10. Create the Auto Details Google Sheet (one-time, run before first deploy)
npx ts-node scripts/create-auto-details-sheet.ts
# → copy the printed Sheet ID, then:
wrangler secret put AUTO_DETAILS_SHEET_ID

# 11. Initial resident sync (after sheets are populated)
curl -X POST https://tracker.bellairetower.com/api/residents/sync \
  -H "CF-Access-Client-Id: ..." -H "CF-Access-Client-Secret: ..."

# 10. Configure Cloudflare Access
# Dashboard → Zero Trust → Access → Applications → Add application
# Type: Self-hosted; Domain: tracker.bellairetower.com
# Policy: Allow email list (add all BoD and HSM emails)
# Copy the AUD tag to CF_ACCESS_AUD secret
```

---


---

## Google APIs — Setup and Integration

### APIs Required

| API | Purpose | Where used |
|-----|---------|-----------|
| **Google Drive API v3** | Browse, link, upload files to Drive | Client + server |
| **Google Picker API** | In-browser file picker for existing Drive files | Client only |
| **Google Sheets API v4** | Export tasks to a Sheet; **import resident roster and auto details from Sheets** | Server (Workers) |
| **Google Identity Services** | OAuth 2.0 token flow for Drive access per user | Client |

Note: resident roster import uses the **service account** (same credentials as Sheets export) with `spreadsheets.readonly` scope. No per-user OAuth needed for sync — the service account must be given read access to both the Roster and Auto Details sheets, or the sheets must be shared with the service account email.

### Google Cloud Console Setup

```
1. Go to console.cloud.google.com → Create project: "Bellaire HOA Tracker"

2. Enable APIs:
   APIs & Services → Library → enable each:
   - Google Drive API
   - Google Picker API
   - Google Sheets API

3. Create OAuth 2.0 Client ID:
   APIs & Services → Credentials → Create Credentials → OAuth client ID
   Application type: Web application
   Name: HOA Tracker
   Authorized JavaScript origins:
     https://tracker.bellairetower.com
   Authorized redirect URIs:
     https://tracker.bellairetower.com/auth/google/callback
   → Copy Client ID (public) and Client Secret (private)

4. Create API Key (for Picker API):
   Credentials → Create Credentials → API Key
   Restrict to: Google Picker API
   Restrict HTTP referrers to: tracker.bellairetower.com/*
   → Copy API Key

5. Configure OAuth consent screen:
   OAuth consent screen → Internal (if using Google Workspace)
     OR External with specific test users listed
   Scopes to add:
     https://www.googleapis.com/auth/drive.file
       (only files created by this app — tightest scope for uploads)
     https://www.googleapis.com/auth/drive.readonly
       (for Picker to browse all user files)
     https://www.googleapis.com/auth/spreadsheets
       (for Sheets export — service account)
     https://www.googleapis.com/auth/spreadsheets.readonly
       (for resident roster + auto details import — service account)

6. For Sheets export — create a Service Account:
   Credentials → Create Credentials → Service Account
   Name: hoa-tracker-export
   Role: Editor
   → Create key → JSON → download
   → Extract private_key and client_email from JSON
   → Store as wrangler secrets: GOOGLE_SA_PRIVATE_KEY, GOOGLE_SA_EMAIL
   The service account creates Sheets in its own Drive and shares them with the requesting user.

7. Add secrets to Cloudflare:
   wrangler secret put GOOGLE_CLIENT_SECRET
   wrangler secret put GOOGLE_SA_PRIVATE_KEY   # from service account JSON
   wrangler secret put GOOGLE_SA_EMAIL         # from service account JSON

8. Add GOOGLE_CLIENT_ID and GOOGLE_PICKER_API_KEY as [vars] in wrangler.toml
   (these are safe to expose to the browser)

9. Share the two resident Google Sheets with the service account:
   - Open the Resident Roster sheet → Share → paste the service account email
     (from GOOGLE_SA_EMAIL, looks like hoa-tracker-export@....iam.gserviceaccount.com)
   - Set permission to Viewer
   - Repeat for the Auto Details sheet once it's created
```

### Attachment UI — Dual Source

The attachment panel in TaskDetail presents two buttons:

```
  [ 📎 Upload file ]   [ 📁 Add from Google Drive ]
```

**"Upload file"** — standard file input. File is POST'd to `/api/tasks/:id/attachments`.
The Worker streams it to R2. Best for: photos from phone, small PDFs.

**"Add from Google Drive"** — opens the Google Picker:
1. Client requests a short-lived OAuth access token via Google Identity Services
   (`google.accounts.oauth2.initTokenClient` — popup flow, no redirect needed)
2. Picker opens with the access token
3. User selects file(s); Picker returns `{ id, name, mimeType, iconLink, webViewLink }`
4. Client POSTs these metadata fields to `/api/tasks/:id/attachments/drive`
5. Worker writes a row to `attachments` with `source = 'google_drive'`; no file bytes stored in R2
6. Worker verifies the file is accessible (HEAD request to Drive API) before confirming

**"Upload to Drive"** — variant of the above where the user wants to upload a local file
directly into Drive (rather than R2):
1. Client calls `GET /api/drive/upload-url` to get a Drive resumable upload URI
   (Worker calls Drive API with service account to create the file and returns the upload URI)
2. Client uploads file bytes directly to Drive via the resumable upload URI
3. Client POSTs the resulting Drive file ID to `/api/tasks/:id/attachments/drive`

### Attachment Display

In the attachment list, each item renders differently by source:

```typescript
// R2 attachment
<a href="/api/attachments/{id}/download">
  <img src="/api/attachments/{id}/thumbnail" />   // if image
  {filename}
</a>

// Google Drive attachment
<a href="{drive_web_view_link}" target="_blank" rel="noopener">
  <img src="{drive_icon_url}" />    // Drive file type icon
  {filename}
  <span class="badge-drive">Drive ↗</span>
</a>
```

Drive attachments open in Google Drive in a new tab. The Drive share permissions are
the user's own — the app stores only the link, not a copy of the file. If the Drive
file is deleted or unshared, the link will become stale (show as "File unavailable").

### Worker: Drive Attachment Route (`src/routes/attachments.ts`)

```typescript
// POST /api/tasks/:id/attachments/drive
app.post('/api/tasks/:id/attachments/drive', requireRole('board','management','vendor'), async (c) => {
  const user = c.get('user') as User;
  const taskId = parseInt(c.req.param('id'));
  const { drive_file_id, filename, mime_type, drive_web_view_link,
          drive_download_url, drive_icon_url } = await c.req.json();

  if (!drive_file_id || !filename) return c.json({ error: 'Missing fields' }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO attachments
      (id, task_id, uploaded_by, filename, mime_type, source,
       drive_file_id, drive_web_view_link, drive_download_url, drive_icon_url)
    VALUES (?, ?, ?, ?, ?, 'google_drive', ?, ?, ?, ?)
  `).bind(id, taskId, user.id, filename, mime_type,
          drive_file_id, drive_web_view_link, drive_download_url, drive_icon_url).run();

  // System comment
  await addSystemComment(c.env.DB, taskId, user,
    `Attached Google Drive file: ${filename}`);
  await notifySubscribers(c.env, taskId, { type: 'attachment', actor: user, ... });

  return c.json({ id, source: 'google_drive', filename, drive_web_view_link });
});
```

---

## Google Sheets Export (`src/routes/admin.ts`)

**Route:** `GET /api/export/sheets?include=archived` (Board/Admin only)

The Worker uses the service account to create a new Google Sheet, populate it with
current task data, then share the Sheet with the requesting user's email so they
own it in their own Drive going forward.

```typescript
// src/google/sheets.ts

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API  = 'https://www.googleapis.com/drive/v3/files';

export async function exportToSheets(env: Env, tasks: Task[], requestingUserEmail: string) {
  // 1. Get a service account access token (JWT → token exchange)
  const token = await getServiceAccountToken(env, [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ]);

  // 2. Create a new spreadsheet
  const createRes = await fetch(SHEETS_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title: `HOA Task Export — ${new Date().toLocaleDateString()}` },
      sheets: [
        { properties: { title: 'Active Tasks' } },
        { properties: { title: 'Archived Tasks' } },
        { properties: { title: 'All Tags' } },
      ],
    }),
  });
  const { spreadsheetId, spreadsheetUrl } = await createRes.json();

  // 3. Write header + data rows using batchUpdate
  const headers = ['ID','Title','Status','Priority','Group','Owner',
                   'Due Date','Awaiting Board','Board Direction','Tags',
                   'Est. Cost','Created','Updated'];
  const rows = tasks.map(t => [
    t.id, t.title, t.status, t.priority, t.responsibility_group,
    t.owner_name ?? '', t.due_date ?? '',
    t.awaiting_board ? 'Yes' : 'No',
    t.board_direction ?? '',
    t.tags.map(g => g.name).join(', '),
    t.estimated_cost ?? '', t.created_at, t.updated_at,
  ]);

  await fetch(`${SHEETS_API}/${spreadsheetId}/values/Active%20Tasks!A1:M${rows.length+1}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [headers, ...rows] }),
  });

  // 4. Share the spreadsheet with the requesting user
  await fetch(`${DRIVE_API}/${spreadsheetId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: requestingUserEmail }),
  });

  return spreadsheetUrl;
}

// Service account JWT → access token
async function getServiceAccountToken(env: Env, scopes: string[]): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim  = btoa(JSON.stringify({
    iss: env.GOOGLE_SA_EMAIL,
    scope: scopes.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  // Sign with service account private key using WebCrypto
  const privateKey = await importPrivateKey(env.GOOGLE_SA_PRIVATE_KEY);
  const signature  = await signJwt(`${header}.${claim}`, privateKey);
  const jwt = `${header}.${claim}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const { access_token } = await res.json();
  return access_token;
}
```

**UI trigger:** Admin/Board users see an **Export to Google Sheets** button in Settings.
On click, a spinner shows while the Worker creates the Sheet; on success, a link to the
new Sheet opens in a new tab. The Sheet lives permanently in the requesting user's Drive.

**Suggested export schedule:** Run manually after each board meeting. No automatic trigger
needed — this is a backup/reporting tool, not a cost control mechanism.

## Phase 2 Features (not in initial build)

- Resident request portal (separate subdomain, limited role)
- iCal feed per user (`/api/me/calendar.ics`)
- Meeting agenda generator endpoint (`POST /api/agenda`)
- Recurring task auto-creation
- Mobile app wrapper (PWA manifest + service worker for offline read)
- Two-factor approval workflow (Board vote with named approvals)
- Vendor contact profiles (license, insurance expiry warnings)

---

## Out of Scope

- Real-time collaboration (WebSockets) — polling on task detail view every 30s is sufficient
- Rich text editor beyond basic markdown — plain textarea with markdown preview is fine for v1
- SSO for residents — email/magic-link for phase 2 resident portal

---

## Success Criteria

- All 28 existing tracker items importable and visually correct
- Board member opening the app sees their most urgent items without any filtering
- HSM can update status, add comment, and flag awaiting-board in under 30 seconds
- Board direction field is visually inaccessible (hidden or disabled) for Management role
- Email notifications arrive within 60 seconds of a change
- Archive search returns results for keywords found in title, description, or comments
- App loads under 1 second on mobile (Workers edge serving)
- Full functionality on iOS Safari and Chrome Android
- Google Drive file picker opens and attaches a Drive file in under 5 seconds
- Google Sheets export produces a correctly populated Sheet shared with the requesting user
- Drive attachment links render correctly and open in Drive; stale links show a graceful "File unavailable" state
- Cloudflare free tier not exceeded at 28–500 tasks, 30 users, and typical daily usage
