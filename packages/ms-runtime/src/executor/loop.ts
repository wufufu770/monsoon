/**
 * 执行器三明治循环（方案 v2.5 步骤二/批次二）：领取 → PreExecutionProof →
 * （连 Loom 时）登记 → 检查点 → 执行 → 结算/等待。
 *
 * 副作用语义（DURABLE.md）：
 * - read 级工具不登记（无可逆动作）；
 * - write 及以上连 Loom 时必须登记 + 检查点，执行后**不自行结算**——
 *   未结算的 intent 由中心操作员核对（reconcile 权限在 Loom 是 operator），
 *   恢复时对账结论为 wait-human；
 * - 非 replay-safe 工具（write 及以上默认 unsafe）恢复时不重跑。
 */
import { AuditChain } from "../policy/audit-chain.js";
import { createHash } from "node:crypto";
import { runPreExecutionProof, type ProofExecutionPolicy } from "./pre-execution-proof.js";
import { projectCenterLedger, reconcileWithCenterLedger } from "./durable.js";
import { claimNextLocal, dispatchLocalTask, finishLocalTask, getLocalTask } from "../scheduler/dispatch.js";
import type { DatabaseSync } from "node:sqlite";
import { LoomClient } from "../loom/client.js";

export interface ExecutorTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly readOnly: boolean;
  readonly networkAccess: "none" | "declared" | "undeclared";
  readonly sideEffectLevel: "read" | "write" | "destructive" | "irreversible";
  readonly execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ExecutorLoopOptions {
  readonly scheduler: DatabaseSync;
  readonly executor: DatabaseSync;
  readonly workerId: string;
  readonly tools: readonly ExecutorTool[];
  /** 连 Loom（组合/分布式形态）时提供；缺省 = 独立形态（不登记）。 */
  readonly loom?: LoomClient;
  readonly loomTenantHomeDir?: string;
  /** 执行域策略（PreExecutionProof 注入）。缺省本地域 + 批准到 write。 */
  readonly policy?: ProofExecutionPolicy;
  readonly pollIntervalMs?: number;
  readonly now?: () => number;
  readonly onEvent?: (event: { type: string; payload: Record<string, unknown> }) => void;
}

export type TickOutcome =
  | { readonly kind: "idle" }
  | { readonly kind: "executed"; readonly taskId: string; readonly result: unknown }
  | { readonly kind: "proof-rejected"; readonly taskId: string; readonly failures: readonly string[] }
  | { readonly kind: "wait-reconcile"; readonly taskId: string; readonly callId: string }
  | { readonly kind: "wait-human"; readonly taskId: string; readonly callId: string }
  | { readonly kind: "failed"; readonly taskId: string; readonly reason: string };

/** 副作用 call_id：四段式键的 sha256（64 hex，与 Loom reconcile 的标识约束对齐）。 */
export function sideEffectCallId(workerId: string, taskId: string, attempt: number): string {
  return createHash("sha256").update(`${workerId}:${taskId}:${attempt}`).digest("hex");
}

export class ExecutorLoop {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly options: ExecutorLoopOptions) {}

  start(): void {
    const interval = this.options.pollIntervalMs ?? 250;
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        console.error("[ms-executor] tick error", error);
      });
    }, interval);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private audit(type: string, payload: Record<string, unknown>): void {
    this.options.onEvent?.({ type, payload });
  }

  private checkpoints(): DatabaseSync {
    return this.options.executor;
  }

  /** 恢复对账：启动时扫描 executing 相位的检查点，以中心账本为准。 */
  async recover(): Promise<{ callId: string; verdict: string; taskId: string }[]> {
    const rows = this.checkpoints()
      .prepare("SELECT id, snapshot FROM checkpoints WHERE json_extract(snapshot,'$.phase')='executing'")
      .all() as { id: string; snapshot: string }[];
    const results: { callId: string; verdict: string; taskId: string }[] = [];
    for (const row of rows) {
      const snap = JSON.parse(row.snapshot) as {
        taskId: string; callId: string; toolName?: string; sideEffectLevel?: string;
        centerRunId?: string; replaySafe: boolean; localTaskId: string;
      };
      let verdict = "proceed";
      if (this.options.loom && snap.centerRunId) {
        try {
          const events = await this.options.loom.eventsAll(snap.centerRunId);
          const ledger = projectCenterLedger(events, snap.callId);
          const v = reconcileWithCenterLedger(
            { callId: snap.callId, toolName: snap.toolName ?? "", sideEffectLevel: "write", registeredAt: "" },
            ledger,
          );
          verdict = v.verdict;
        } catch (error) {
          // 中心暂不可达：本条留待下次启动再对账，不阻塞其余恢复、不崩进程。
          this.audit("recovery.deferred", {
            callId: snap.callId, taskId: snap.taskId,
            reason: error instanceof Error ? error.message : String(error),
          });
          results.push({ callId: snap.callId, verdict: "deferred", taskId: snap.localTaskId });
          continue;
        }
      }
      if (verdict === "wait-human") {
        // 非 replay-safe：不重跑。本地任务转 failed（原因=转人工），检查点保留供核对。
        finishLocalTask(this.options.scheduler, snap.localTaskId, false,
          { waitHuman: true, callId: snap.callId, reason: "未结算副作用，转人工核对" });
        this.audit(`recovery.${verdict}`, { callId: snap.callId, taskId: snap.taskId });
      } else if (verdict === "re-register") {
        // 回退到登记之前阶段：清除检查点，任务回队（replay-safe 工具可安全重跑，
        // 非 replay-safe 的场景不会出现在本分支——有副作用必有登记）。
        this.checkpoints().prepare("DELETE FROM checkpoints WHERE id=?").run(row.id);
        this.options.scheduler.prepare("UPDATE queue SET status='queued' WHERE id=?")
          .run(snap.localTaskId);
        this.audit(`recovery.${verdict}`, { callId: snap.callId, taskId: snap.taskId });
      } else {
        // proceed：无中心登记信息的检查点（read 级任务）执行完成即清账。
        if (!snap.callId) {
          this.checkpoints().prepare("DELETE FROM checkpoints WHERE id=?").run(row.id);
        }
        this.audit(`recovery.${verdict}`, { callId: snap.callId, taskId: snap.taskId });
      }
      results.push({ callId: snap.callId, verdict, taskId: snap.localTaskId });
    }
    return results;
  }

  /** 单次轮询：领取一个本地任务并走完整三明治。 */
  async tick(): Promise<TickOutcome> {
    const task = claimNextLocal(this.options.scheduler, this.options.workerId);
    if (task === null) return { kind: "idle" };
    this.audit("task.claimed", { taskId: task.id, template: task.template });

    const tool = this.options.tools.find((candidate) => candidate.name === task.template);
    if (tool === undefined) {
      finishLocalTask(this.options.scheduler, task.id, false, { reason: "未知模板" });
      this.audit("task.failed", { taskId: task.id, reason: "未知模板" });
      return { kind: "failed", taskId: task.id, reason: "未知模板" };
    }

    const policy: ProofExecutionPolicy = this.options.policy ?? {
      executionDomain: this.options.loom ? "remote" : "local",
      approvedSideEffectLevels: ["read", "write"],
    };
    const params = JSON.parse(task.params) as Record<string, unknown>;
    const proof = runPreExecutionProof(
      {
        tool: { name: tool.name, readOnly: tool.readOnly, networkAccess: tool.networkAccess },
        sideEffectLevel: tool.sideEffectLevel,
        requestedPath: typeof params["path"] === "string" ? (params["path"] as string) : undefined,
        homeDir: this.options.loomTenantHomeDir ?? "/home",
      },
      policy,
    );
    if (!proof.ok) {
      finishLocalTask(this.options.scheduler, task.id, false, { proof: proof.failures });
      this.audit("proof.rejected", { taskId: task.id, failures: proof.failures });
      return { kind: "proof-rejected", taskId: task.id, failures: proof.failures.map((f) => f.code) };
    }

    // 连 Loom：登记中心 run/task/claim + 副作用意图（read 级不登记）。
    // 中心不可达时任务回队（S3 语义：留队不误报完成），下轮轮询重试。
    let centerRunId: string | undefined;
    let centerTaskId: string | undefined;
    let centerEpoch = 0;
    let callId: string | undefined;
    const attempt = 1;
    if (this.options.loom && tool.sideEffectLevel !== "read") {
      try {
        const loom = this.options.loom;
        const { runId, claim } = await loom.ensureClaimedTask({
          runIdempotencyKey: `${task.id}:run`, taskId: `ms-${task.id}`, workerId: this.options.workerId,
        });
        centerRunId = runId;
        centerTaskId = claim.task_id;
        centerEpoch = claim.epoch;
        callId = sideEffectCallId(this.options.workerId, task.id, attempt);
        await loom.registerEffect(runId, {
          task_id: claim.task_id, worker_id: claim.worker_id, epoch: claim.epoch,
          call_id: callId, tool_name: tool.name, side_effect_level: tool.sideEffectLevel,
        }, `${task.id}:effect`);
        this.audit("effect.registered", { taskId: task.id, callId, centerRunId });
      } catch (error) {
        this.options.scheduler.prepare("UPDATE queue SET status='queued' WHERE id=?")
          .run(task.id);
        this.audit("loom.unreachable", {
          taskId: task.id, reason: error instanceof Error ? error.message : String(error),
        });
        return { kind: "failed", taskId: task.id, reason: "Loom 不可达，任务回队待重试" };
      }
    }

    // 检查点：登记之后、执行之前提交。非 replay-safe 的工具在恢复时进入
    // wait-human（不重跑）；replay-safe 的工具可安全重跑。
    const replaySafe = tool.readOnly && tool.networkAccess !== "undeclared";
    this.checkpoints().prepare("INSERT OR REPLACE INTO checkpoints (id, snapshot, updated_at) VALUES (?,?,?)")
      .run(callId ?? task.id, JSON.stringify({
        phase: callId ? "executing" : "executing", taskId: task.id,
        localTaskId: task.id, callId, toolName: tool.name,
        sideEffectLevel: tool.sideEffectLevel, centerRunId, centerTaskId,
        centerEpoch, replaySafe,
      }), Date.now());

    const result = await tool.execute(params);
    this.audit("tool.executed", { taskId: task.id, tool: tool.name });

    if (this.options.loom && centerRunId && callId && tool.sideEffectLevel !== "read") {
      // write 及以上：不自行结算（reconcile 权限在中心 operator），本地任务
      // 标记 wait-reconcile；提交产出被 Loom 的未结算检查阻挡是预期行为。
      finishLocalTask(this.options.scheduler, task.id, false,
        { waitReconcile: true, callId, centerRunId });
      this.audit("task.wait_reconcile", { taskId: task.id, callId });
      return { kind: "wait-reconcile", taskId: task.id, callId };
    }

    finishLocalTask(this.options.scheduler, task.id, true, result);
    // 无中心登记的检查点（read 级）执行完成即清账，避免 recover 误扫。
    if (!callId) {
      this.checkpoints().prepare("DELETE FROM checkpoints WHERE id=?").run(task.id);
    }
    this.audit("task.submitted", { taskId: task.id });
    return { kind: "executed", taskId: task.id, result };
  }
}

export { dispatchLocalTask, finishLocalTask, getLocalTask, claimNextLocal };
