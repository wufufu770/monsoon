/**
 * Mandate 任务级授权凭证（方案 v2.5 拍板十八，super-agent 语义吸收）：
 * 谁经何路径、何强度、何规则版本、何范围——随任务固化，恢复/续派前重校验。
 * 与 Loom lease/epoch 同构：policyVersion ≈ epoch 的授权侧对应物。
 */
import type { ExecutionDomain, SideEffectLevel } from "./security-constants.js";

export interface Mandate {
  readonly strength: "standard" | "elevated";
  /** 签发时的策略版本（规则/模式/来源的哈希）；不匹配即触发重校验。 */
  readonly policyVersion: string;
  readonly basis: {
    readonly via: "addressed" | "followup" | "admission" | "bot";
    readonly source: string;
  };
  readonly actor: string;
  readonly scope: {
    readonly executionDomain: ExecutionDomain;
    readonly sideEffectLevels: readonly SideEffectLevel[];
  };
}

export interface MandateRevalidationInput {
  readonly currentPolicyVersion: string;
  readonly executionDomain: ExecutionDomain;
  readonly requestedLevel: SideEffectLevel;
}

export type MandateVerdict =
  | { readonly verdict: "proceed" }
  | { readonly verdict: "reject"; readonly reason: string };

/** 恢复/续派前重校验：策略版本一致、域一致、请求等级在凭证范围内。 */
export function revalidateMandate(mandate: Mandate, input: MandateRevalidationInput): MandateVerdict {
  if (mandate.policyVersion !== input.currentPolicyVersion) {
    return { verdict: "reject", reason: "策略版本已变更，凭证需重新签发" };
  }
  if (mandate.scope.executionDomain !== input.executionDomain) {
    return { verdict: "reject", reason: "执行域与凭证范围不符" };
  }
  if (!mandate.scope.sideEffectLevels.includes(input.requestedLevel)) {
    return { verdict: "reject", reason: `副作用等级 ${input.requestedLevel} 不在凭证范围内` };
  }
  return { verdict: "proceed" };
}
