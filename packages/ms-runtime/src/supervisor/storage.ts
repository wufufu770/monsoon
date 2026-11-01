/**
 * 本机 SQLite 存储句柄（步骤一）：调度器与执行器各自独立句柄、
 * 共用本机数据目录。零外部依赖——node:sqlite（Node ≥22.5，v24 无需 flag）。
 *
 * 调度器库：触发规则 + 待触发队列 + 待交产物（降级独立，方案 4.4 节）。
 * 执行器库：pi-durable 检查点与本地审计链（步骤二接线时使用）。
 */
import { DatabaseSync } from "node:sqlite";

export interface LocalStores {
  readonly scheduler: DatabaseSync;
  readonly executor: DatabaseSync;
  close(): void;
}

export function openLocalStores(dataDir: string): LocalStores {
  const scheduler = new DatabaseSync(`${dataDir}/scheduler.db`);
  const executor = new DatabaseSync(`${dataDir}/executor.db`);
  scheduler.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS triggers (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, spec TEXT NOT NULL,
      template TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      next_fire_at INTEGER);
    CREATE TABLE IF NOT EXISTS queue (
      id TEXT PRIMARY KEY, template TEXT NOT NULL, params TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', requested_by TEXT,
      created_at INTEGER NOT NULL, result TEXT);
    CREATE TABLE IF NOT EXISTS outbound (
      id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
  `);
  executor.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY, snapshot TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (
      seq INTEGER PRIMARY KEY, type TEXT NOT NULL, actor TEXT NOT NULL,
      payload TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
  `);
  return {
    scheduler, executor,
    close() {
      scheduler.close();
      executor.close();
    },
  };
}
