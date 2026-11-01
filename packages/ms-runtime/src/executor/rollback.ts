/**
 * 回滚分支（方案 v2.5 步骤七收尾，NetMind 事务性回滚语义——只引入语义不复制代码）。
 *
 * v3 契约：Loom 的 reconcile 响应携带可选 `rollback_hint`
 * { call_id, tool_name, reason, params? }（Loom 侧 Phase 1 可始终返回 null）。
 * ms 侧按"非空才回滚"处理；回滚动作本身**也是一个副作用**——执行前以新
 * call_id 登记（POST /effects）并提交 pi-durable 检查点，防止回滚被执行两次。
 *
 * 审计事件（入本地哈希链）：effect.rollback_started / effect.rollback_completed /
 * effect.rollback_failed / effect.rollback_unsupported。
 * PreExecutionProof 的三校验（执行前）保持不动，本模块只补"执行后"分支。
 */
import type { AuditChain } from "../policy/audit-chain.js";

export interface RollbackHint {
  readonly callId: string;
  readonly toolName: string;
  readonly reason: string;
  readonly params?: Record<string, unknown>;
}

export interface ReconcileOutcome {
  readonly callId: string;
  readonly state: "completed" | "not_sent";
  readonly rollbackHint?: RollbackHint | null;
}

/** 工具声明（与 adapter-kit ConnectorTool 对齐）：rollback 是否声明。 */
export interface RollbackToolDeclaration {
  readonly name: string;
  readonly rollback?: boolean;
}

/** 执行器注入的回滚环境：审计链、副作用登记（新 call_id）、真正的回滚执行。 */
export interface RollbackContext {
  readonly audit: AuditChain;
  /** 回滚自身登记：POST /effects + pi-durable 检查点（实现方保证幂等）。 */
  readonly registerSideEffect: (input: {
    callId: string;
    toolName: string;
    sideEffectLevel: "read" | "write" | "destructive" | "irreversible";
  }) => Promise<void>;
  /** 能力插件的回滚执行（实现方保证幂等）。 */
  readonly executeRollback: (hint: RollbackHint) => Promise<void>;
  /** 回滚动作自身的副作用等级（代码常量缺省 write）。 */
  readonly rollbackSideEffectLevel?: "read" | "write" | "destructive" | "irreversible";
}

export type RollbackKind =
  | "none"
  | "rollback_unsupported"
  | "rollback_started"
  | "rollback_failed";

export interface RollbackOutcome {
  readonly kind: RollbackKind;
  /** 回滚自身登记的 call_id（kind=rollback_started 时存在）。 */
  readonly rollbackCallId?: string;
  readonly reason?: string;
}

/** 回滚自身登记的 call_id 派生规则：与原始调用绑定、永不相同。 */
export function rollbackCallId(originalCallId: string): string {
  return `${originalCallId}:rollback`;
}

/**
 * reconcile 的回滚处理：非空 hint 才处理；未声明 rollback 的工具绝不尝试回滚。
 * 判定与三段审计事件全部入本地哈希链。
 */
export async function handleReconcileRollback(
  outcome: ReconcileOutcome,
  tool: RollbackToolDeclaration,
  context: RollbackContext,
): Promise<RollbackOutcome> {
  const hint = outcome.rollbackHint;
  if (!hint) return { kind: "none", reason: "reconcile 未携带 rollback_hint" };

  if (tool.rollback !== true) {
    context.audit.append({
      type: "effect.rollback_unsupported",
      actor: "executor",
      payload: { callId: outcome.callId, toolName: hint.toolName, reason: hint.reason },
    });
    return { kind: "rollback_unsupported", reason: "工具未声明 rollback 能力，转人工介入" };
  }

  const derivedCallId = rollbackCallId(hint.callId);
  context.audit.append({
    type: "effect.rollback_started",
    actor: "executor",
    payload: { callId: outcome.callId, rollbackCallId: derivedCallId, toolName: hint.toolName, reason: hint.reason },
  });
  try {
    // 回滚本身是副作用：登记（防回滚被执行两次）后再执行。
    await context.registerSideEffect({
      callId: derivedCallId,
      toolName: hint.toolName,
      sideEffectLevel: context.rollbackSideEffectLevel ?? "write",
    });
    await context.executeRollback(hint);
    context.audit.append({
      type: "effect.rollback_completed",
      actor: "executor",
      payload: { callId: outcome.callId, rollbackCallId: derivedCallId, toolName: hint.toolName },
    });
    return { kind: "rollback_started", rollbackCallId: derivedCallId, reason: hint.reason };
  } catch (error) {
    context.audit.append({
      type: "effect.rollback_failed",
      actor: "executor",
      payload: {
        callId: outcome.callId, rollbackCallId: derivedCallId, toolName: hint.toolName,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return { kind: "rollback_failed", rollbackCallId: derivedCallId, reason: "回滚执行失败，转人工介入" };
  }
}
