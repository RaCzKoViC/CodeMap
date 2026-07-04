/* Otwiera bazę SQLite (WAL) i wykonuje schema.sql. */
import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// Względny DATA_DIR liczony od katalogu server/ (niezależnie od CWD); bezwzględny bez zmian.
export const DATA_DIR = resolve(HERE, process.env.DATA_DIR || 'data');
export const BLOB_DIR = join(DATA_DIR, 'blobs');

mkdirSync(BLOB_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, 'codemap.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
db.exec(readFileSync(join(HERE, 'schema.sql'), 'utf8'));

export const now = () => Date.now();
