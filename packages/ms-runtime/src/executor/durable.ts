/**
 * Pi Durable 执行器内核适配（方案 v2.5 步骤二）。
 *
 * 锁定 `@earendil-works/pi-durable@1.4.0`（Experimental，API 无预告变化——
 * 不跟随 latest，见 DURABLE.md 的版本锁定理由）。pi-durable 自带 Node SQLite
 * 存储（`openNodeSqliteStorage`），不自写 Storage 适配器。
 *
 * 效果三明治时序（DURABLE.md 详述）：
 *   意图 → Loom 登记（POST /effects）→ 检查点提交（call_id + level）→
 *   执行 → 结算（reconcile）。恢复时以中心账本为准对账。
 */
import { type SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

export const PI_DURABLE_VERSION = "1.4.0";

/** 打开（或创建）执行器的 Pi Durable 文件存储。跨重启恢复由存储自身保证。 */
export async function openExecutorKernel(
  dataDir: string,
): Promise<{ storage: SqliteStorage; close: () => Promise<void> }> {
  const storage = await openNodeSqliteStorage(`${dataDir}/executor-durable.db`);
  return {
    storage,
    // sqlite 实现忽略 context 形参；传空对象仅为满足签名（进程退出也会由驱动收尾）。
    close: () => storage.close({} as never),
  };
}

/**
 * replay-safe 判定（步骤二.3，与 adapter-kit 的 networkAccess 对齐）：
 * 当且仅当 readOnly === true 且 networkAccess 为 none/declared 才是 "safe"；
 * undeclared 一律 "unsafe"，即使它声明了 readOnly。
 */
export function toolReplayPolicy(tool: {
  readOnly?: boolean;
  networkAccess?: "none" | "declared" | "undeclared";
}): "safe" | "unsafe" {
  const networkAccess = tool.networkAccess ?? "undeclared";
  return tool.readOnly === true && (networkAccess === "none" || networkAccess === "declared")
    ? "safe"
    : "unsafe";
}

/** 副作用检查点内容：恢复时判断"这个副作用是否已登记"的最小集合。 */
export interface SideEffectCheckpoint {
  readonly callId: string;
  readonly toolName: string;
  readonly sideEffectLevel: "read" | "write" | "destructive" | "irreversible";
  readonly registeredAt: string;
}

/** 中心账本对账结论（本机检查点 vs 中心账本——以中心为准）。 */
export type LedgerVerdict =
  | { readonly verdict: "proceed"; readonly reason: string }
  | { readonly verdict: "re-register"; readonly reason: string }
  | { readonly verdict: "wait-human"; readonly reason: string };

/**
 * 恢复对账（步骤二.4）：执行器恢复后、执行任何副作用之前，核对中心账本
 * （步骤三登记端点的持久行，或其 events 过滤投影）。**以中心账本为准**：
 *
 * - 中心已有该 call_id 的 intent 行 → 本机从检查点恢复后**继续**（不重跑
 *   非 replay-safe 工具本身；继续的是检查点之后的阶段）。
 * - 中心没有该行 → 本机检查点回退到"登记之前"的阶段（re-register）。
 * - 中心行存在但处于未结算态且无法确认结果 → wait-human。
 */
export function reconcileWithCenterLedger(
  checkpoint: SideEffectCheckpoint,
  centerLedger: { readonly hasRegistration: boolean; readonly settled: boolean },
): LedgerVerdict {
  if (!centerLedger.hasRegistration) {
    return {
      verdict: "re-register",
      reason: `中心账本无 ${checkpoint.callId} 的登记行，本机回退到登记之前阶段`,
    };
  }
  if (!centerLedger.settled) {
    return {
      verdict: "wait-human",
      reason: `中心账本 ${checkpoint.callId} 已登记未结算，不重放，转人工核对`,
    };
  }
  return { verdict: "proceed", reason: "中心账本已登记且结算一致" };
}

/**
 * 中心账本投影（步骤二.4 的临时通道）：从 run 事件流过滤 tool.intent /
 * 结算事件，判定某 call_id 的登记与结算状态。**不新增 Loom 端点**。
 */
export function projectCenterLedger(
  events: readonly { readonly type?: string; readonly payload?: Record<string, unknown> }[],
  callId: string,
): { hasRegistration: boolean; settled: boolean } {
  let hasRegistration = false;
  let settled = false;
  for (const event of events) {
    const payloadCallId = event.payload?.["call_id"] ?? event.payload?.["callId"];
    if (payloadCallId !== callId) continue;
    if (event.type === "tool.intent") hasRegistration = true;
    if (event.type === "tool.reconciled" || event.type === "tool-effect.reconciled") settled = true;
  }
  return { hasRegistration, settled };
}
