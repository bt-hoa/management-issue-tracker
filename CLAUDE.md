# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this directory is

This is the **project planning directory** for the Bellaire Tower HOA Task Tracker — a purpose-built web app replacing a Google Sheets workflow. No application code exists here yet. The key documents are:

| File | Purpose |
|------|---------|
| `HOA_TRACKER_DESIGN.md` | Product design document — roles, data model, views, notification rules, tech stack |
| `TASK-hoa-tracker-app.md` | Full build specification — repo structure, schema SQL, TypeScript types, API routes, frontend architecture, deployment steps, Google API integration |
| `data/HOA Board ↔ Management Tracker - Tracker.csv` | Live export of the current tracker; this is the migration source |
| `support-files/Google Sheet Version/HOA_Tracker_Data.csv` | Original v1 tracker CSV (archived reference) |
| `support-files/Google Sheet Version/HOA_Tracker_AppsScript.js` | Original Google Sheets automation being replaced |

**Note:** The Buildium resident portal API is not available to us. Resident data is managed via Google Sheets instead — see "Resident roster" section below.

## App being built

**Bellaire Tower HOA Board ↔ Management Tracker** — a task and communication tracker for the HOA Board (BoD) and their management company (HSM Contact).

**Deployment:** Cloudflare Workers + D1 (SQLite) + R2 + KV  
**Domain:** `tracker.bellairetower.com`  
**Auth:** Cloudflare Access (Google OAuth) — no auth code in the app, just JWT verification  
**Frontend:** Vanilla TypeScript + Vite (no framework); served as static assets via `[site]` binding  
**API framework:** Hono.js  
**Email:** Resend API  
**File attachments:** Dual-source — R2 for direct uploads, Google Drive for document linking

## Key architectural decisions

- **Smart sort is server-side.** The `sort=smart` mode computes a numeric `sort_score` per task using status, priority, awaiting-board flag, viewer role, and due-date proximity. See `computeSortScore()` in `TASK-hoa-tracker-app.md`.
- **Board Direction is role-gated.** Management role must never be able to write the `board_direction` field. This is enforced in API middleware, not just UI.
- **Awaiting Board is a first-class workflow.** Flipping `awaiting_board = true` triggers an email to all Board members; recording a Board Direction triggers notification back to Management.
- **Attachments are dual-source.** The `attachments` table stores metadata only; actual bytes are either in R2 (`source = 'r2'`, keyed by `r2_key`) or linked from Google Drive (`source = 'google_drive'`, using Drive URLs). Never store Drive file bytes in R2.
- **Full-text search uses fts5.** D1 supports fts5 virtual tables. The schema includes `tasks_fts` with insert/update triggers to keep it in sync. Use `tasks_fts MATCH ?` for archive search.
- **Cron jobs are in `src/worker.ts`** `scheduled()` handler: Friday 8am weekly digest; daily 6am overdue check (sets `status = 'overdue'` for past-due tasks).
- **Frontend router is hash-based.** `#/`, `#/tasks/:id`, `#/tasks/new`, `#/archive`, `#/settings`.
- **Component pattern:** Each frontend component class exposes `render(): HTMLElement`, `update(data)`, and `destroy()`. No virtual DOM, no framework diffing.

## Resident roster (Google Sheets — replaces Buildium)

Two Google Sheets feed resident data into the app. Both are imported via the Sheets API using the service account:

| Sheet | Owner | Contents | Direction |
|-------|-------|----------|-----------|
| **Resident Roster** | HSM | Unit #, resident name, email, phone, owner vs. tenant, move-in date | Sheet → App (import/sync) |
| **Auto Details** | Doormen / Management | Resident name, unit, vehicle make/model/color/plate, parking spot | Sheet → App (import/sync) |

The Auto Details sheet is **new** — created as part of this project. Management and doormen will fill it in from offline records. The template column layout is defined in `TASK-hoa-tracker-app.md`.

Both sheet IDs are stored as wrangler secrets (`RESIDENT_ROSTER_SHEET_ID`, `AUTO_DETAILS_SHEET_ID`). Sync is triggered manually from Settings → Residents → Sync Now, and also runs on the daily 6am cron.

## Wrangler / deployment commands

```bash
# First-time setup
wrangler d1 create hoa-tracker         # copy database_id → wrangler.toml
wrangler d1 execute hoa-tracker --file=schema.sql
wrangler kv:namespace create SESSIONS  # copy id → wrangler.toml
wrangler r2 bucket create hoa-tracker-attachments

# Secrets (run once each)
wrangler secret put RESEND_API_KEY
wrangler secret put CF_ACCESS_AUD
wrangler secret put CF_TEAM_DOMAIN
wrangler secret put FROM_EMAIL
wrangler secret put APP_URL
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_SA_PRIVATE_KEY
wrangler secret put GOOGLE_SA_EMAIL
wrangler secret put RESIDENT_ROSTER_SHEET_ID   # from the roster sheet URL
wrangler secret put AUTO_DETAILS_SHEET_ID      # from the auto details sheet URL

# Build + deploy
cd frontend && npm install && npm run build && cd ..
wrangler deploy

# Local development (Workers + D1 local)
wrangler dev

# Data migration from existing CSV
npx ts-node scripts/import-csv.ts "data/HOA Board ↔ Management Tracker - Tracker.csv" > seed.sql
wrangler d1 execute hoa-tracker --file=seed.sql
```

## Role permission summary

| Action | Admin | Board | Management | Vendor |
|--------|-------|-------|------------|--------|
| Write Board Direction | ✓ | ✓ | ✗ | ✗ |
| Flip Awaiting Board | ✓ | ✓ | ✓ | ✗ |
| Archive/restore tasks | ✓ | ✓ | ✗ | ✗ |
| Manage users/tags | ✓ | ✗ | ✗ | ✗ |
| View/update assigned tasks | ✓ | ✓ | ✓ | own only |

## Existing data

`Google Sheet Version/HOA_Tracker_Data.csv` has 28 tasks. Column mapping for import is in `TASK-hoa-tracker-app.md` under "CSV Import Script". Key columns: `Section` → tag, `Responsibility` → group (HSM→management, BoD→board), `Awaiting BoD?` → `awaiting_board`, `What HSM is waiting on BoD for` → `awaiting_board_text`, `BoD Direction / Response` → `board_direction`, `Notes / History` → first system comment.
