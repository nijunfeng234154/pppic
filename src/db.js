import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path) {
  const db = new DatabaseSync(path);
  if (db.prepare('PRAGMA user_version').get().user_version > 1) { db.close(); throw new Error('数据库版本高于当前应用，请使用匹配的应用版本'); }
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE,
      ext TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL CHECK(size>0),
      object_key TEXT NOT NULL UNIQUE, driver TEXT NOT NULL,
      album TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS images_created ON images(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS images_album ON images(album, created_at DESC);
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE, scope TEXT NOT NULL CHECK(scope IN ('upload','read','manage')),
      created_at TEXT NOT NULL, last_used_at TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL) STRICT;
    PRAGMA user_version=1;
  `);
  return db;
}
