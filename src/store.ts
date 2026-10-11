/**
 * SQLite storage for fourthread.
 * Uses the built-in node:sqlite DatabaseSync (Node 20+ ... requires Node >= 22).
 * WAL mode; every append commits its own transaction.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { emptyCheckpoint, type CheckpointV1, type Turn } from "./schema.js";

// Loaded via createRequire so bundlers/test-runners don't try to resolve
// the `node:sqlite` builtin statically.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): unknown;
    prepare(sql: string): {
      run(...args: unknown[]): { lastInsertRowid: number | bigint; changes: number | bigint };
      get(...args: unknown[]): unknown;
      all(...args: unknown[]): unknown[];
    };
    close(): void;
  };
};

type SqliteDb = InstanceType<typeof DatabaseSync>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  bot TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  model TEXT
);
CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot TEXT NOT NULL,         -- 'shared' or a bot id
  fact TEXT NOT NULL,
  ts TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS memory_dedup ON memory(bot, fact);
`;

export class ThreadStore {
  private db: SqliteDb;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec(SCHEMA);
    this.ensureMeta("schema_version", "checkpoint_v1");
    this.ensureMeta("thread_id", crypto.randomUUID());
  }

  private ensureMeta(key: string, value: string) {
    this.db
      .prepare("INSERT OR IGNORE INTO meta(key, value) VALUES(?, ?)")
      .run(key, value);
  }

  getMeta(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string) {
    this.db
      .prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  appendTurn(turn: Omit<Turn, "id">): Turn {
    const stmt = this.db.prepare(
      "INSERT INTO turns(ts, bot, role, content, model) VALUES(?, ?, ?, ?, ?)"
    );
    const res = stmt.run(turn.ts, turn.bot, turn.role, turn.content, turn.model);
    return { ...turn, id: Number(res.lastInsertRowid) };
  }

  loadThread(): Turn[] {
    return this.db
      .prepare("SELECT id, ts, bot, role, content, model FROM turns ORDER BY id")
      .all() as unknown as Turn[];
  }

  /** Insert if the exact (bot, fact) pair is not already stored. Returns true if inserted. */
  saveMemory(bot: string, fact: string, ts = new Date().toISOString()): boolean {
    const res = this.db
      .prepare("INSERT OR IGNORE INTO memory(bot, fact, ts) VALUES(?, ?, ?)")
      .run(bot, fact.trim(), ts);
    return res.changes > 0;
  }

  loadMemory(bot: string): string[] {
    const rows = this.db
      .prepare("SELECT fact FROM memory WHERE bot = ? ORDER BY id")
      .all(bot) as unknown as { fact: string }[];
    return rows.map((r) => r.fact);
  }

  exportCheckpoint(): CheckpointV1 {
    const metaKeys = ["task_intent", "next_step", "parent_session_id"] as const;
    const out = emptyCheckpoint(this.getMeta("thread_id") ?? "unknown");
    for (const k of metaKeys) out[k] = this.getMeta(k) || null;
    out.file_watchlist = JSON.parse(this.getMeta("file_watchlist") ?? "[]");
    out.approvals = JSON.parse(this.getMeta("approvals") ?? "[]");
    out.turns = this.loadThread();
    return out;
  }

  importCheckpoint(cp: CheckpointV1): void {
    this.setMeta("schema_version", "checkpoint_v1");
    this.setMeta("thread_id", cp.thread_id);
    this.setMeta("task_intent", cp.task_intent ?? "");
    this.setMeta("next_step", cp.next_step ?? "");
    this.setMeta("file_watchlist", JSON.stringify(cp.file_watchlist));
    this.setMeta("approvals", JSON.stringify(cp.approvals));
    if (cp.parent_session_id) this.setMeta("parent_session_id", cp.parent_session_id);
    const clear = this.db.prepare("DELETE FROM turns");
    const insert = this.db.prepare(
      "INSERT INTO turns(id, ts, bot, role, content, model) VALUES(?, ?, ?, ?, ?, ?)"
    );
    clear.run();
    for (const t of cp.turns) {
      insert.run(t.id, t.ts, t.bot, t.role, t.content, t.model);
    }
  }

  close(): void {
    this.db.close();
  }
}
