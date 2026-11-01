/**
 * 本机派活与队列（方案 v2.5 步骤二/批次二的调度器存储操作）：
 * 独立形态的派活入口落点——模板+参数 进队列，执行器领取。
 * 所有 SQL 参数绑定（安全约束）；队列在调度器库，执行器经独立连接领取
 * （WAL 多进程）。
 */
import type { DatabaseSync } from "node:sqlite";

export interface LocalTaskRow {
  readonly id: string;
  readonly template: string;
  readonly params: string;
  readonly status: "queued" | "running" | "done" | "failed";
  readonly requested_by: string | null;
  readonly result: string | null;
}

let counter = 0;

/** 独立形态派活入口：入队并返回任务 id。 */
export function dispatchLocalTask(
  scheduler: DatabaseSync,
  input: { template: string; params: Record<string, unknown>; requestedBy?: string },
): string {
  counter += 1;
  const id = `ms-${Date.now()}-${counter}`;
  scheduler.prepare(
    "INSERT INTO queue (id, template, params, status, requested_by, created_at) VALUES (?,?,?,?,?,?)",
  ).run(id, input.template, JSON.stringify(input.params), "queued", input.requestedBy ?? null, Date.now());
  return id;
}

/** 执行器领取：队列头部的 queued 任务置 running（原子）。 */
export function claimNextLocal(scheduler: DatabaseSync, workerId: string): LocalTaskRow | null {
  const row = scheduler
    .prepare("SELECT id, template, params, status, requested_by, result FROM queue WHERE status='queued' ORDER BY created_at LIMIT 1")
    .get() as LocalTaskRow | undefined;
  if (row === undefined) return null;
  const updated = scheduler
    .prepare("UPDATE queue SET status='running' WHERE id=? AND status='queued'")
    .run(row.id);
  if (updated.changes === 0) return null; // 其他执行器抢先
  void workerId;
  return { ...row, status: "running" };
}

/** 完成或失败：写结果。 */
export function finishLocalTask(scheduler: DatabaseSync, id: string, ok: boolean, result: unknown): void {
  scheduler.prepare("UPDATE queue SET status=?, result=? WHERE id=?")
    .run(ok ? "done" : "failed", JSON.stringify(result) ?? null, id);
}

/** 查询任务（e2e 断言用）。 */
export function getLocalTask(scheduler: DatabaseSync, id: string): LocalTaskRow | null {
  return (scheduler.prepare(
    "SELECT id, template, params, status, requested_by, result FROM queue WHERE id=?",
  ).get(id) as LocalTaskRow | undefined) ?? null;
}
