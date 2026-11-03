/**
 * 准入三档（方案 v2.5 拍板十八，super-agent observe 语义吸收）：
 * off / observe / auto。observe 档照常研判但**只记录不执行**——自动化
 * 灰度上线的标准动作；auto 档仍受"不做自动批准"拍板约束（写操作永远弹卡）。
 */
import type { GatewayEvent } from "../scheduler/event-gateway.js";

export type AdmissionMode = "off" | "observe" | "auto";

export interface AdmissionDecision {
  readonly accepted: boolean;
  /** observe 档记录 would_accept（灰度数据），供复算"自动是否更优"。 */
  readonly wouldAccept: boolean;
  readonly reason: string;
}

/** 确定性准入判定（与 super-agent 的 gate 同性质：研判可外挂，gate 本身是纯函数）。 */
export function admissionDecide(
  mode: AdmissionMode,
  passesGate: boolean,
  event: GatewayEvent,
): AdmissionDecision {
  if (mode === "off") return { accepted: false, wouldAccept: false, reason: "准入关闭" };
  if (passesGate) {
    if (mode === "observe") {
      return { accepted: false, wouldAccept: true, reason: `observe: 记录 would_accept（${event.dedupKey}）` };
    }
    return { accepted: true, wouldAccept: true, reason: "auto: 通过准入门" };
  }
  return { accepted: false, wouldAccept: false, reason: "未通过准入门" };
}
