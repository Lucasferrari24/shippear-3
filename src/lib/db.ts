// Acceso a la base SQLite de inspecciones (quality_control.db) con el SQLite que trae Node (node:sqlite).
// Al abrirla aplica las migraciones de db/migrations/ que falten.
// Solo para el servidor: en Vercel el disco no persiste, así que la recolección es para correr local.

import fs from "node:fs";
import path from "node:path";

type Row = Record<string, unknown>;
type Statement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
};
export type Db = {
  exec(sql: string): void;
  prepare(sql: string): Statement;
};
type SqliteModule = { DatabaseSync: new (file: string) => Db };

export const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR ?? "data");
const DB_PATH = path.resolve(process.cwd(), process.env.DB_PATH ?? "data/quality_control.db");
const MIGRATIONS_DIR = path.resolve(process.cwd(), "db/migrations");

let db: Db | null = null;

export function getDb(): Db {
  if (db) return db;
  // getBuiltinModule evita que el bundler de Next intente resolver node:sqlite.
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as SqliteModule;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const conn = new DatabaseSync(DB_PATH);
  conn.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  migrate(conn);
  db = conn;
  return conn;
}

function migrate(conn: Db) {
  const hasTable = conn
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  const applied = new Set(
    hasTable ? conn.prepare("SELECT version FROM schema_migrations").all().map((r) => Number(r.version)) : [],
  );
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  for (const file of files) {
    const version = Number(file.split("_")[0]);
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    // El cambio de CHECK en defects recrea la tabla: las FK se apagan mientras dura la migración.
    conn.exec("PRAGMA foreign_keys = OFF; BEGIN;");
    try {
      conn.exec(sql);
      conn.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)").run(version);
      conn.exec("COMMIT;");
    } catch (e) {
      conn.exec("ROLLBACK;");
      throw new Error(`Falló la migración ${file}: ${(e as Error).message}`);
    } finally {
      conn.exec("PRAGMA foreign_keys = ON;");
    }
  }
}

/** Corre fn dentro de una transacción. */
export function tx<T>(fn: (conn: Db) => T): T {
  const conn = getDb();
  conn.exec("BEGIN;");
  try {
    const out = fn(conn);
    conn.exec("COMMIT;");
    return out;
  } catch (e) {
    conn.exec("ROLLBACK;");
    throw e;
  }
}
