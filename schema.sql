CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'management',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  title                TEXT NOT NULL,
  description          TEXT,
  status               TEXT NOT NULL DEFAULT 'not_started',
  priority             TEXT NOT NULL DEFAULT 'normal',
  responsibility_group TEXT NOT NULL DEFAULT 'management',
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
  recurrence_rule      TEXT,
  archived_at          TEXT,
  created_by           TEXT REFERENCES users(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
  id    TEXT PRIMARY KEY,
  name  TEXT UNIQUE NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1'
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT    REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    TEXT    REFERENCES users(id),
  content    TEXT NOT NULL,
  is_system  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mentions (
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT    NOT NULL REFERENCES users(id),
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE IF NOT EXISTS task_links (
  task_id         INTEGER NOT NULL REFERENCES tasks(id),
  linked_task_id  INTEGER NOT NULL REFERENCES tasks(id),
  link_type       TEXT NOT NULL DEFAULT 'related',
  PRIMARY KEY (task_id, linked_task_id)
);

CREATE TABLE IF NOT EXISTS approvals (
  id       TEXT PRIMARY KEY,
  task_id  INTEGER NOT NULL REFERENCES tasks(id),
  user_id  TEXT    NOT NULL REFERENCES users(id),
  vote     TEXT    NOT NULL,
  note     TEXT,
  voted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id                  TEXT PRIMARY KEY,
  task_id             INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by         TEXT    REFERENCES users(id),
  filename            TEXT NOT NULL,
  mime_type           TEXT NOT NULL,
  size_bytes          INTEGER,
  source              TEXT NOT NULL DEFAULT 'r2',
  r2_key              TEXT UNIQUE,
  drive_file_id       TEXT UNIQUE,
  drive_web_view_link TEXT,
  drive_download_url  TEXT,
  drive_icon_url      TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS residents (
  id               TEXT PRIMARY KEY,
  unit             TEXT NOT NULL,
  name             TEXT NOT NULL,
  email            TEXT,
  phone            TEXT,
  resident_type    TEXT NOT NULL DEFAULT 'owner',
  move_in_date     TEXT,
  notes            TEXT,
  roster_row       INTEGER,
  roster_synced_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resident_vehicles (
  id                TEXT PRIMARY KEY,
  resident_id       TEXT NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  make              TEXT,
  model             TEXT,
  color             TEXT,
  license_plate     TEXT,
  parking_spot      TEXT,
  auto_details_row  INTEGER,
  synced_at         TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_status       ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_owner        ON tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_tasks_archived     ON tasks(archived_at);
CREATE INDEX IF NOT EXISTS idx_tasks_awaiting     ON tasks(awaiting_board);
CREATE INDEX IF NOT EXISTS idx_comments_task      ON comments(task_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_task_tags_task     ON task_tags(task_id);
CREATE INDEX IF NOT EXISTS idx_residents_unit     ON residents(unit);
CREATE INDEX IF NOT EXISTS idx_vehicles_resident  ON resident_vehicles(resident_id);

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
