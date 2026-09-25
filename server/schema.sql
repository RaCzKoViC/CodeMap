CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash     TEXT NOT NULL,
  lang          TEXT NOT NULL DEFAULT 'pl',
  verified_at   INTEGER,
  quota_bytes   INTEGER NOT NULL DEFAULT 2147483648,
  used_bytes    INTEGER NOT NULL DEFAULT 0,
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_tokens (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('verify','reset')),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_etok_user ON email_tokens(user_id, kind);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  user_agent   TEXT,
  ip           TEXT
);
CREATE INDEX IF NOT EXISTS idx_sess_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS settings (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  json       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_map (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ts         INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  blob_path  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS maps (
  id          TEXT NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('codemap','mindmap')),
  name        TEXT NOT NULL,
  project_key TEXT,
  updated_at  INTEGER NOT NULL,
  size_bytes  INTEGER NOT NULL,
  blob_path   TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS snapshots (
  id          TEXT NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_key TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  label       TEXT,
  name        TEXT,
  source      TEXT,
  signature   TEXT,
  size_bytes  INTEGER NOT NULL,
  blob_path   TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_snap_proj ON snapshots(user_id, project_key, ts);

CREATE TABLE IF NOT EXISTS vault_meta (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album      TEXT NOT NULL CHECK (album IN ('vault','fav')),
  meta_json  TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, album)
);

CREATE TABLE IF NOT EXISTS vault_files (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album      TEXT NOT NULL CHECK (album IN ('vault','fav')),
  name       TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime      INTEGER NOT NULL,
  blob_path  TEXT NOT NULL,
  PRIMARY KEY (user_id, album, name)
);

-- Nieudane logowania per adres (także dla nieistniejących kont — bez wyroczni istnienia).
-- Po 5 porażkach blokada rośnie wykładniczo (30 s → 15 min); sukces kasuje wpis.
CREATE TABLE IF NOT EXISTS login_attempts (
  email        TEXT PRIMARY KEY COLLATE NOCASE,
  fails        INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

-- Wysłane maile per adres (limit 3/h niezależnie od IP — koniec z mail-bombingiem przez
-- rejestrację/resend/reset z wielu adresów IP).
CREATE TABLE IF NOT EXISTS mail_log (
  email   TEXT NOT NULL COLLATE NOCASE,
  kind    TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_log ON mail_log(email, sent_at);
