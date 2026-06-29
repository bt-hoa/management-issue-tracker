# Bellaire Tower — Task & Communication Tracker
## Product Design Document

**Version:** 1.0  
**Prepared for:** Board of Directors  
**Platform:** Web application (Cloudflare Workers)

---

## 1. Purpose and Goals

Replace the Google Sheets tracker with a purpose-built web application that:

- Presents each user a **focused, role-aware view** of open tasks — not a raw spreadsheet
- Makes the **BoD ↔ HSM handoff** (flagging items, recording direction) a first-class workflow
- Handles **notifications, subscriptions, and audit history** automatically
- Scales as the number of tasks, users, and document attachments grows
- Is accessible from any device — phone, tablet, or desktop

---

## 2. User Roles

| Role | Who | What they can do |
|------|-----|-----------------|
| **Admin** | Paul (BoD) | Everything; user management; tag management |
| **Board** | BoD members | Full read/write; record BoD directions; archive tasks; approve items |
| **Management** | HSM contacts | Update status/notes on tasks assigned to them; flag awaiting board; cannot write BoD Direction field |
| **Vendor** | Contractors (Everest, Cintas, etc.) | View and update tasks they are assigned to; add comments/photos |
| **Resident** | Building owners/tenants (optional phase 2) | Read-only view of tasks affecting them; submit requests. Resident identity is sourced from Google Sheets, not Buildium (API not available). |

Each user authenticates with their Google account (Cloudflare Access handles this — no passwords to manage).

---

## 3. Data Model

### Task
| Field | Type | Notes |
|-------|------|-------|
| ID | Auto | Sequential, human-readable (#1, #2…) |
| Title | Text | Short, required |
| Description | Rich text | Full detail |
| Status | Enum | Not Started / In Progress / Overdue / Blocked / Complete |
| Priority | Enum | Urgent / High / Normal / Low — set by Board |
| Responsibility Group | Enum | Board / Management / Vendor / Joint / Individual |
| Owner | User | Individual responsible; auto-subscribed to all changes |
| Due Date | Date | Optional target date |
| Awaiting Board | Boolean | Flipped by Management; triggers Board notification |
| Awaiting Board Text | Text | What specifically is needed from the Board |
| Board Direction | Text | Written by Board only; triggers Management notification |
| Board Direction Date | Date | Auto-stamped |
| Tags | Many | Replaces categories; tasks can have multiple |
| Attachments | Files | Photos, PDFs, quotes, reports |
| Archived At | Timestamp | Null = active; set = archived |
| Created By | User | |
| Created At | Timestamp | |
| Updated At | Timestamp | Auto-updated on any change |

### Comment / Activity Entry
Each task has a threaded activity log combining:
- **User comments** — typed by any authorized user
- **System events** — automatic entries: "Status changed from In Progress → Overdue by HSM Contact (Jun 2)"
- **@mentions** — notify a specific user inline

This replaces the flat "Notes / History" field with a proper audit trail.

### Tags
Freeform labels created by Admin/Board. Examples from current data:
`legal` `financial` `communication` `facilities` `electrical` `staffing` `parking` `compliance` `elevator` `plumbing` `insurance` `vendor` `urgent` `resident-impact`

Tasks carry multiple tags. The sidebar filters by tag.

### Resident

The building's resident roster is managed in two Google Sheets (not Buildium — that API is unavailable):

| Sheet | Managed by | Key fields |
|-------|-----------|-----------|
| **Resident Roster** | HSM | Unit, name, email, phone, owner vs. tenant, move-in date |
| **Auto Details** | Doormen / Management | Unit, resident name, vehicle make/model/color/plate, assigned parking spot |

The app imports both sheets via the Sheets API and stores the data locally in D1. Sync is manual (Settings → Residents → Sync Now) plus a daily background job.

The Auto Details sheet is created as part of this project — management and doormen fill it in from offline sources (parking records, vehicle registration forms, etc.).

Resident data surfaces in the task tracker wherever a unit number is mentioned, and will be the foundation for the Phase 2 resident request portal.

### Subscriptions
Any user can subscribe to any task. The task owner is auto-subscribed. Subscribers receive email on any change (status, comment, Board direction, attachment added).

---

## 4. Views and Screens

### 4.1 Main Task List (default landing)

**Smart sort** — order computed at render time based on viewer role:

*For Board members:*
1. 🔴 Overdue (by due date, oldest first)
2. 🟡 Awaiting Board action (by age, oldest first)
3. 🔵 Urgent priority, in progress
4. 🔵 High priority, in progress
5. ⚪ Normal/Low, in progress
6. ⬜ Not Started
7. ⬛ Blocked

*For Management (HSM):*
1. Their own overdue tasks
2. Tasks where Board has recorded direction (needs follow-through)
3. Their own in-progress tasks
4. Other in-progress tasks
5. Not started

*For Vendors:*
Only tasks where they are the owner — sorted by due date.

**Sort override buttons** (always visible):
`Smart` · `Due Date` · `Priority` · `Last Updated` · `Group` · `Owner`

**Filter sidebar** (collapsible):
- Status checkboxes (default: hide Complete and Archived)
- Responsibility Group
- Tags (multi-select)
- Owner
- "Awaiting Board only" toggle
- "My tasks only" toggle

**Task row** shows:
- ID + Title
- Status badge + Priority indicator
- Group + Owner name
- Due date (red if overdue)
- Tag chips (first 3, then +N)
- Awaiting Board indicator (amber)
- Last updated timestamp
- Comment count

### 4.2 Task Detail View

Full-screen (or large modal) with two columns:

**Left — main content:**
- Title (editable inline for Board/Admin)
- Description (rich text)
- Awaiting Board banner (amber, prominent) with the text of what's needed
- Board Direction section (green, editable only by Board)
- Activity / Comment thread — chronological, newest at bottom; system events in gray italic, user comments in white/primary; @mention support

**Right — metadata sidebar:**
- Status (dropdown)
- Priority (dropdown)
- Responsibility Group (dropdown)
- Owner (user picker)
- Due Date (date picker)
- Tags (multi-select with create-on-type)
- Subscribers list + Subscribe/Unsubscribe button
- Attachments (drag-drop upload; thumbnails for images, icons for PDFs)
- Created / Updated timestamps
- Archive button (Board/Admin only)

**Action bar** at top:
`Edit` · `Add Comment` · `Attach File` · `Subscribe` · `Archive`

### 4.3 Archive View

Searchable list of completed/archived tasks. Full-text search across title, description, comments. Same filters as main view. Each row has a **Restore** button to move back to active. Useful for finding past decisions and precedents ("what did we decide about parking enforcement last year?").

### 4.4 New Task / Edit Task

Clean form — same fields as detail sidebar. Tag autocomplete with create-on-type. Owner field shows avatar + name. Due date shows calendar picker. Rich text editor for description.

### 4.5 Board Dashboard (Board role only)

Summary panel at top of main list:
- **N items awaiting Board action** (amber count, clickable to filter)
- **N overdue** (red)
- **N tasks with unread activity** (blue dot)
- **N due this week**

Optionally: one-click **Generate Meeting Agenda** — produces a formatted list of all Awaiting Board items and overdue items, sorted by priority, ready to paste into a document.

### 4.6 Settings / Admin

- **Users** — invite, edit role, deactivate
- **Tags** — create, rename, change color, merge two tags
- **Email** — digest schedule (default: Friday 8am); test send button
- **Import** — CSV import to seed initial data (migration from Sheets)
- **Residents** — view synced resident list; trigger manual sync from Google Sheets; shows last-sync timestamp and row counts for both Roster and Auto Details sheets

---

## 5. Notifications

| Event | Who is notified |
|-------|----------------|
| Task owner assigned | New owner |
| Awaiting Board flipped to Yes | All Board members |
| Board Direction recorded | Task owner + all Management subscribers |
| Status change | Task subscribers |
| New comment | Task subscribers (except commenter) |
| @mention in comment | Mentioned user (even if not subscribed) |
| Attachment added | Task subscribers |
| Task overdue (due date passes) | Task owner + Board |
| Weekly digest | All Board members — overdue, awaiting board, in progress |

All emails include a direct link to the task and a one-click unsubscribe for that task.

---

## 6. Additional Features (suggested)

### 6.1 Task Linking
Tasks can be linked as **related** or **blocking**. Example: Unit 801/701 shower drain task is linked to the building insurance task (if water damage occurs). Related tasks show in the detail sidebar.

### 6.2 Approval / Vote Workflow
Board-flagged tasks can require a formal vote (approve/decline) rather than just a written direction. Board members click Approve or Decline; result is recorded with names and timestamps. Useful for expenditure approvals (backflow repair $7,854), fee schedule decisions, vendor selections.

### 6.3 Recurring Tasks
Weekly tasks (HSM building visit, Friday office hours) can be marked as recurring. Completion of one instance auto-creates the next. Reduces noise in the task list.

### 6.4 File Attachments with Annotations
Images (inspection photos, damage photos, progress photos) can be annotated with arrows and text directly in the browser. Stored in Cloudflare R2.

### 6.5 Cost / Budget Tracking
Financial tasks can optionally carry an **Estimated Cost** and **Approved Budget** field. Running total visible in the dashboard. Useful for the backflow repair, Cintas proposal, Everest project.

### 6.6 Vendor Contacts
Each vendor user profile can carry company name, phone, license number, and insurance expiration. Visible in the task sidebar when a vendor is the owner. Surfaces "vendor insurance expires in 30 days" warnings.

### 6.7 Meeting Agenda Generator
One-click from the dashboard: produces a structured agenda document from all open Awaiting Board items, sorted by section/priority. Downloadable as PDF or copy-to-clipboard for email.

### 6.8 Calendar / iCal Feed
Personal iCal subscription URL per user — due dates for their tasks appear in Google Calendar or Apple Calendar automatically.

### 6.9 Resident Request Portal (Phase 2)
A separate, simplified view for residents — submit a maintenance request or question, view status of building-wide items that affect them (elevator outages, construction timelines). No access to internal BoD/HSM communication.

---

## 7. Design Language

**Aesthetic:** Refined utilitarian — clean, legible, efficient. Not a consumer app, not a generic dashboard. Designed for people who need to make decisions, not browse content.

- Dense information design — more rows visible at once than a typical SaaS app
- Status badges with strong color coding (overdue = red, awaiting board = amber, complete = green)
- Mobile-first responsive — full functionality on a phone
- Dark sidebar / light content area
- Monospace font for IDs and timestamps; humanist sans-serif for content
- Keyboard shortcuts for power users (J/K navigation, C to comment, E to edit)

---

## 8. Technology Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Runtime | Cloudflare Workers | Serverless, global CDN, no infra to manage |
| Database | Cloudflare D1 (SQLite) | Relational, full-text search, free tier generous |
| File storage | Cloudflare R2 | S3-compatible, no egress fees |
| Sessions | Cloudflare KV | Fast token lookup |
| Auth | Cloudflare Access + Google OAuth | Zero-config SSO with Google accounts the team already has |
| Email | Mailgun or Resend API | Simple HTTP call from Workers |
| API framework | Hono.js | Lightweight, Workers-native, TypeScript |
| Frontend | Vanilla TypeScript + Vite | No framework overhead; Workers serves static assets |
| Scheduled jobs | Workers Cron Triggers | Weekly digest, overdue detection |
| Deployment | Wrangler CLI | `wrangler deploy` — single command |

---

## 9. Migration Path

1. Export current Google Sheet as CSV
2. Admin imports CSV via Settings → Import
3. Script maps existing columns to new schema, creates default tags from section names
4. Run in parallel with Sheets for one meeting cycle
5. Decommission Sheets after sign-off from all users
