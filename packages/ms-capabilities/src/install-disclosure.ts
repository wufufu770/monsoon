/**
 * 安装披露（方案 v2.5 拍板三/判据 G9 的 ms 侧）：能力安装确认的三项披露
 * （能力名、只读标记、联网声明）+ 回滚能力——进审计事件，定位是披露不是门禁。
 */
import type { AuditChain } from "@monsoon/ms-runtime/policy";
import type { NetworkAccess, SideEffectLevel } from "@monsoon/ms-runtime/policy";
import { DEFAULT_NETWORK_ACCESS } from "@monsoon/ms-runtime/policy";

export interface InstallDisclosure {
  readonly name: string;
  readonly readOnly: boolean;
  readonly networkAccess: NetworkAccess;
  readonly rollback: boolean;
  readonly sideEffectLevel: SideEffectLevel;
}

export interface EffectiveDisclosure {
  readonly name: string;
  readonly readOnly: boolean;
  /** 未声明按可能联网处理（缺省语义是代码常量，不可放宽）。 */
  readonly networkAccess: NetworkAccess;
  readonly rollback: boolean;
  readonly sideEffectLevel: SideEffectLevel;
}

/** 折叠声明缺省值（undeclared 取保守侧）并产出审计事件（G9：三项进审计）。 */
export function recordInstallDisclosure(
  audit: AuditChain,
  disclosure: InstallDisclosure,
): EffectiveDisclosure {
  const effective: EffectiveDisclosure = {
    name: disclosure.name,
    readOnly: disclosure.readOnly,
    networkAccess: disclosure.networkAccess ?? DEFAULT_NETWORK_ACCESS,
    rollback: disclosure.rollback,
    sideEffectLevel: disclosure.sideEffectLevel,
  };
  audit.append({
    type: "capability.installed",
    actor: "installer",
    payload: {
      name: effective.name,
      readOnly: effective.readOnly,
      networkAccess: effective.networkAccess,
      rollback: effective.rollback,
      sideEffectLevel: effective.sideEffectLevel,
    },
  });
  return effective;
}

/** 调用期披露文案：未声明联网时的提示（不拦截）。 */
export function disclosureText(effective: EffectiveDisclosure): string {
  const network = effective.networkAccess === "none"
    ? "此能力不出网"
    : effective.networkAccess === "declared"
      ? "此能力已声明需要联网"
      : "此能力未声明联网行为，按可能联网处理";
  const effect = effective.readOnly ? "只读" : `写（${effective.sideEffectLevel}）`;
  const rollback = effective.rollback ? "，支持回滚" : "";
  return `${effective.name}：${effect}；${network}${rollback}。`;
}
