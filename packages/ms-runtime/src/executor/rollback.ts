/**
 * 回滚分支（方案 v2.5 步骤七收尾，NetMind 事务性回滚语义）：
 * Loom 的副作用 reconcile 响应增加可选 `rollback_hint`（Loom 侧可暂时返回 null）。
 * ms 执行器收到非空 hint 时，按工具声明的回滚动作执行本地回滚；工具未声明
 * 回滚能力时不得执行任何动作，转为待人工（写审计）。
 */
export interface RollbackHint {
  /** 回滚动作标识，由 Loom 侧对账策略给出（如 "fs.undo-write"）。 */
  readonly action: string;
  readonly params?: Record<string, unknown>;
}

export interface ReconcileOutcome {
  readonly callId: string;
  readonly state: "completed" | "not_sent";
  readonly rollbackHint?: RollbackHint | null;
}

/** 工具侧声明的回滚能力（能力插件在工具声明里提供）。 */
export interface RollbackCapability {
  /** 可回滚的动作标识集合（与 hint.action 匹配才执行）。 */
  readonly supportedActions: readonly string[];
  /** 执行回滚；实现方保证幂等。 */
  readonly execute: (hint: RollbackHint) => Promise<void>;
}

export type RollbackDecision =
  | { readonly action: "rollback"; readonly hint: RollbackHint }
  | { readonly action: "manual"; readonly reason: string }
  | { readonly action: "none"; readonly reason: string };

export function planRollback(outcome: ReconcileOutcome, capability: RollbackCapability | null): RollbackDecision {
  const hint = outcome.rollbackHint;
  if (!hint) return { action: "none", reason: "reconcile 未携带 rollback_hint" };
  if (!capability) return { action: "manual", reason: "工具未声明回滚能力，转人工" };
  if (!capability.supportedActions.includes(hint.action)) {
    return { action: "manual", reason: `工具不支持回滚动作 ${hint.action}` };
  }
  return { action: "rollback", hint };
}

/** 执行回滚判定并返回审计载荷（判定入哈希链）。 */
export async function applyRollback(
  outcome: ReconcileOutcome,
  capability: RollbackCapability | null,
): Promise<{ decision: RollbackDecision; audit: Record<string, unknown> }> {
  const decision = planRollback(outcome, capability);
  if (decision.action === "rollback") {
    await capability!.execute(decision.hint);
  }
  const audit = {
    type: `rollback.${decision.action}`,
    actor: "executor",
    payload: { callId: outcome.callId, state: outcome.state, reason: "reason" in decision ? decision.reason : null },
  };
  return { decision, audit };
}
