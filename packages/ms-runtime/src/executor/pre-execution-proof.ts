/**
 * 执行前安全证明（方案 v2.5 步骤七，NetMind 语义）。
 *
 * 位置：执行器在调用 Loom 的 `POST /v1/runs/{id}/effects` 登记意图**之后**、
 * 真正执行工具**之前**。三件事本地校验；任一不通过则不执行，
 * 写本地审计（入哈希链）并请求人工介入。
 *
 * 三个校验全部是**本地**判定：批准范围与执行域策略由调用方注入
 * （来源是中心批准的计划与 Space 策略的本地投影），绊线是代码常量。
 */
import {
  HIGH_RISK_SIDE_EFFECT_LEVELS,
  SIDE_EFFECT_LEVELS,
  type SideEffectLevel,
} from "../policy/security-constants.js";
import { evaluateCredentialGuard } from "../policy/credential-guard.js";

export interface ProofToolDeclaration {
  readonly name: string;
  readonly readOnly?: boolean;
  readonly networkAccess?: "none" | "declared" | "undeclared";
}

export interface ProofExecutionPolicy {
  /** 当前执行域：本机（local）或中心侧（remote）。 */
  readonly executionDomain: "local" | "remote";
  /** Loom 批准的计划允许的副作用等级集合（本地投影，空=未批准任何写）。 */
  readonly approvedSideEffectLevels: readonly SideEffectLevel[];
  /** 本机策略是否允许工具联网（Space 策略的本地投影；缺省允许但需披露）。 */
  readonly allowNetwork?: boolean;
}

export interface ProofInput {
  readonly tool: ProofToolDeclaration;
  readonly sideEffectLevel: SideEffectLevel;
  /** 本次调用将触达的文件路径（存在才做绊线校验）。 */
  readonly requestedPath?: string;
  readonly homeDir: string;
}

export type ProofFailureCode =
  | "side_effect_level_out_of_scope"
  | "high_risk_requires_proof"
  | "network_policy_mismatch"
  | "credential_tripwire";

export interface ProofFailure {
  readonly code: ProofFailureCode;
  readonly message: string;
}

export interface ProofResult {
  readonly ok: boolean;
  readonly failures: readonly ProofFailure[];
  /** 需要人工介入标记：高危或绊线命中时为 true（由代码常量门槛决定）。 */
  readonly requiresHumanIntervention: boolean;
}

function levelRank(level: SideEffectLevel): number {
  return SIDE_EFFECT_LEVELS.indexOf(level);
}

/** 三校验：副作用等级范围、高危强制证明、联网一致性、凭证绊线。 */
export function runPreExecutionProof(
  input: ProofInput,
  policy: ProofExecutionPolicy,
): ProofResult {
  const failures: ProofFailure[] = [];
  let requiresHumanIntervention = false;

  // 校验一：等级必须落在批准的计划范围内。
  const approved = policy.approvedSideEffectLevels;
  const inScope = approved.includes(input.sideEffectLevel);
  if (!inScope) {
    failures.push({
      code: "side_effect_level_out_of_scope",
      message: `副作用等级 ${input.sideEffectLevel} 不在批准计划范围内（批准：${approved.join("、") || "无"}）`,
    });
  }

  // 校验二（门槛是代码常量）：高危等级强制要求批准范围显式包含，
  // 不接受"未批准但也没禁"的灰态。
  if (HIGH_RISK_SIDE_EFFECT_LEVELS.includes(input.sideEffectLevel) && !inScope) {
    requiresHumanIntervention = true;
  }

  // 校验三：联网声明与执行域策略一致性。undeclared 的写工具在 remote 域
  // 必须先补声明；本机域按 Phase 1 信任模型放行但要求披露（不拦截）。
  const networkAccess = input.tool.networkAccess ?? "undeclared";
  if (networkAccess === "undeclared" && !input.tool.readOnly && policy.executionDomain === "remote") {
    failures.push({
      code: "network_policy_mismatch",
      message: "远端执行域要求写工具显式声明联网行为（undeclared 不可用于 remote）",
    });
  }
  if (networkAccess === "declared" && policy.allowNetwork === false) {
    failures.push({
      code: "network_policy_mismatch",
      message: "本机策略不允许联网，而该工具声明需要联网",
    });
  }

  // 校验四：凭证路径绊线（命中即拒绝并要求人工介入）。
  if (input.requestedPath !== undefined) {
    const verdict = evaluateCredentialGuard(input.requestedPath, input.homeDir);
    if (!verdict.allowed) {
      failures.push({
        code: "credential_tripwire",
        message: `凭证路径绊线命中：${verdict.rule?.label ?? verdict.rule?.id ?? "unknown"}（${verdict.normalizedPath}）`,
      });
      requiresHumanIntervention = true;
    }
  }

  return { ok: failures.length === 0, failures, requiresHumanIntervention };
}
