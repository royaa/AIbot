import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "relay.sqlite"));

// WAL：任务输出写洪峰时显著降低磁盘 IO 抖动（默认 delete journal 每事务重建日志文件）
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pair_codes (
    code TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    hostname TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    device_id TEXT,
    tool TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS task_outputs (
    task_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (task_id, seq)
  );
`);

/** 任务数据保留天数：catchup 兜底只需覆盖手机断线窗口，历史任务输出过期清理 */
const TASK_RETENTION_DAYS = Math.max(
  1,
  Number(process.env.TASK_RETENTION_DAYS ?? 7),
);

/** 启动时清理过期任务与其输出，防止 task_outputs 无限膨胀 */
export function pruneOldTasks(): number {
  const cutoff = Date.now() - TASK_RETENTION_DAYS * 86_400_000;
  const r = db
    .prepare(
      `DELETE FROM tasks WHERE updated_at < ? AND status IN ('completed','failed','cancelled')`,
    )
    .run(cutoff);
  db.prepare(
    `DELETE FROM task_outputs WHERE task_id NOT IN (SELECT id FROM tasks)`,
  ).run();
  db.prepare(`DELETE FROM pair_codes WHERE expires_at < ?`).run(Date.now());
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    /* checkpoint 失败不影响运行 */
  }
  return r.changes;
}

export function savePairCode(
  code: string,
  agentId: string,
  hostname: string,
  expiresAt: number,
) {
  db.prepare(
    `INSERT OR REPLACE INTO pair_codes (code, agent_id, hostname, expires_at) VALUES (?, ?, ?, ?)`,
  ).run(code, agentId, hostname, expiresAt);
}

export function consumePairCode(code: string) {
  const row = db
    .prepare(`SELECT * FROM pair_codes WHERE code = ?`)
    .get(code) as
    | { code: string; agent_id: string; hostname: string; expires_at: number }
    | undefined;
  if (!row) return undefined;
  if (row.expires_at < Date.now()) {
    db.prepare(`DELETE FROM pair_codes WHERE code = ?`).run(code);
    return undefined;
  }
  db.prepare(`DELETE FROM pair_codes WHERE code = ?`).run(code);
  return row;
}

export function registerDevice(id: string, name: string, agentId: string) {
  db.prepare(
    `INSERT OR REPLACE INTO devices (id, name, agent_id, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, name, agentId, Date.now());
}

export function getDevice(id: string) {
  return db.prepare(`SELECT * FROM devices WHERE id = ?`).get(id) as
    | { id: string; name: string; agent_id: string }
    | undefined;
}

export function upsertTask(
  id: string,
  agentId: string,
  deviceId: string | undefined,
  tool: string,
  prompt: string,
  status: string,
) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO tasks (id, agent_id, device_id, tool, prompt, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
  ).run(id, agentId, deviceId ?? null, tool, prompt, status, now, now);
}

export function appendTaskOutput(
  taskId: string,
  seq: number,
  kind: string,
  text: string,
) {
  db.prepare(
    `INSERT OR IGNORE INTO task_outputs (task_id, seq, kind, text) VALUES (?, ?, ?, ?)`,
  ).run(taskId, seq, kind, text);
}

export function getTaskRow(taskId: string) {
  return db.prepare(`SELECT id, agent_id, device_id, status FROM tasks WHERE id = ?`).get(
    taskId,
  ) as
    | { id: string; agent_id: string; device_id: string | null; status: string }
    | undefined;
}

export function getTaskOutputsAfter(taskId: string, afterSeq: number) {
  return db
    .prepare(
      `SELECT seq, kind, text FROM task_outputs WHERE task_id = ? AND seq > ? ORDER BY seq ASC`,
    )
    .all(taskId, afterSeq) as Array<{ seq: number; kind: string; text: string }>;
}
