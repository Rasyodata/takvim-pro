-- =====================================================================
-- Takvim Pro — temel şema (sürüm 0001)
-- Taşınabilir SQL: SQLite 3.35+ ve PostgreSQL 13+ üzerinde çalışacak
-- şekilde yazılmıştır.
--   * Kimlikler uygulama tarafından üretilen UUID metinleridir (TEXT).
--   * Zaman damgaları UTC ISO-8601 metin olarak tutulur (örn. 2026-10-19T12:00:00.000Z).
--   * Takvim tarih/saatleri uygulama saat diliminde (APP_TZ, varsayılan
--     Europe/Istanbul) "YYYY-MM-DDTHH:MM" duvar saati olarak tutulur.
--   * Mantıksal alanlar 0/1 tamsayıdır (CHECK ile korunur).
-- =====================================================================

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,            -- daima küçük harfle saklanır
  password_hash  TEXT NOT NULL,                   -- bcrypt
  role           TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_sample      INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,                  -- oturum belirtecinin SHA-256 özeti
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  color        TEXT NOT NULL DEFAULT '#6366f1',
  description  TEXT NOT NULL DEFAULT '',
  is_sample    INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);

CREATE TABLE IF NOT EXISTS project_members (
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  added_at     TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(user_id);

-- Pano sütunları: ya bir projeye (project_id) ya da bir kullanıcının kişisel panosuna (user_id) aittir.
CREATE TABLE IF NOT EXISTS board_columns (
  id           TEXT PRIMARY KEY,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  is_done      INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
  created_at   TEXT NOT NULL,
  CHECK ((project_id IS NOT NULL AND user_id IS NULL) OR (project_id IS NULL AND user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_columns_project ON board_columns(project_id, position);
CREATE INDEX IF NOT EXISTS idx_columns_user ON board_columns(user_id, position);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  priority      TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  column_id     TEXT NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE, -- durum (sütun)
  project_id    TEXT REFERENCES projects(id) ON DELETE CASCADE,               -- NULL = kişisel görev
  assignee_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  creator_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_date      TEXT,                                                         -- YYYY-MM-DD
  completed_at  TEXT,
  position      INTEGER NOT NULL DEFAULT 0,
  is_sample     INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(column_id, position);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(creator_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);

CREATE TABLE IF NOT EXISTS tags (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,              -- küçük harfle saklanır
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id       TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id);

CREATE TABLE IF NOT EXISTS checklist_items (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  is_done      INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checklist_task ON checklist_items(task_id, position);

CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  start_at     TEXT NOT NULL,                     -- YYYY-MM-DDTHH:MM (APP_TZ)
  end_at       TEXT NOT NULL,
  all_day      INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  category     TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('work', 'meeting', 'personal', 'health', 'education', 'social', 'other')),
  color        TEXT NOT NULL DEFAULT '#64748b',
  notes        TEXT NOT NULL DEFAULT '',
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
  is_sample    INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  CHECK (end_at >= start_at)
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);
CREATE INDEX IF NOT EXISTS idx_events_owner ON events(owner_id);
CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id);

CREATE TABLE IF NOT EXISTS event_attendees (
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'accepted', 'declined')),
  added_at     TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_attendees_user ON event_attendees(user_id);

CREATE TABLE IF NOT EXISTS comments (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id, created_at);

CREATE TABLE IF NOT EXISTS activity_log (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL,                     -- task, event, project, column, comment, user
  entity_id    TEXT,
  action       TEXT NOT NULL,                     -- created, updated, moved, deleted, assigned, commented ...
  details      TEXT NOT NULL DEFAULT '{}',        -- JSON
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_log(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id, created_at);
