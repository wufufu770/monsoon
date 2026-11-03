/**
 * 中心注册表与多中心调度（方案 v2.5 拍板十五，批次四）：
 * 一台 ms 同时配对多台 Loom——每中心独立配对/凭证/游标/连接状态；
 * 加权轮询保证调度公平性；per-center 失联只冻结该中心。
 */
export interface CenterRegistration {
  /** 中心稳定标识（本地生成，进审计与幂等键溯源）。 */
  readonly centerId: string;
  readonly baseUrl: string;
  /** 双具名主体（方案 5.3）：operator 提交目标/计划，worker 领取/提交产出。 */
  readonly operatorToken: string;
  readonly workerToken: string;
  readonly tenantId: string;
  /** 调度权重（默认 1；等权起步，按方案 6.4 节数据复算后调整）。 */
  readonly weight?: number;
  /** 该中心并发上限（可配），总量仍受本地上限约束。 */
  readonly maxConcurrent?: number;
}

export type CenterStatus = "online" | "offline";

export interface CenterEntry extends CenterRegistration {
  /** 事件游标：每中心各持自己的（判据 A3）。 */
  cursor: number;
  status: CenterStatus;
  /** 连续失败计数（达到阈值判失联；成功即清零，避免抖动误判）。 */
  consecutiveFailures: number;
}

export const OFFLINE_THRESHOLD = 3;

export class CenterRegistry {
  private readonly centers = new Map<string, CenterEntry>();
  /** 平滑加权轮询的当前游标（nginx smooth WRR 语义）。 */
  private readonly current = new Map<string, number>();

  register(reg: CenterRegistration): CenterEntry {
    const entry: CenterEntry = {
      ...reg, weight: reg.weight ?? 1, maxConcurrent: reg.maxConcurrent ?? 2,
      cursor: 0, status: "online", consecutiveFailures: 0,
    };
    this.centers.set(reg.centerId, entry);
    return entry;
  }

  get(centerId: string): CenterEntry | undefined {
    return this.centers.get(centerId);
  }

  all(): readonly CenterEntry[] {
    return [...this.centers.values()];
  }

  /** per-center 失联：只冻结该中心（拍板十五.4），成功清零计数。 */
  markFailure(centerId: string): CenterStatus {
    const entry = this.centers.get(centerId);
    if (!entry) return "offline";
    entry.consecutiveFailures += 1;
    if (entry.consecutiveFailures >= OFFLINE_THRESHOLD) entry.status = "offline";
    return entry.status;
  }

  markSuccess(centerId: string): CenterStatus {
    const entry = this.centers.get(centerId);
    if (!entry) return "offline";
    entry.consecutiveFailures = 0;
    entry.status = "online";
    return entry.status;
  }

  /** 消费并推进该中心的事件游标（游标归消费者所有）。 */
  advanceCursor(centerId: string, nextSeq: number): void {
    const entry = this.centers.get(centerId);
    if (entry && nextSeq > entry.cursor) entry.cursor = nextSeq;
  }

  /**
   * 平滑加权轮询（只考虑 online 中心）：每次调用选出一个中心；
   * 权重相等时退化为轮转。
   */
  pickOnline(): CenterEntry | null {
    const online = this.all().filter((entry) => entry.status === "online");
    if (online.length === 0) return null;
    let total = 0;
    for (const entry of online) {
      this.current.set(entry.centerId, (this.current.get(entry.centerId) ?? 0) + entry.weight!);
      total += entry.weight!;
    }
    let best: CenterEntry | null = null;
    for (const entry of online) {
      if (best === null || this.current.get(entry.centerId)! > this.current.get(best.centerId)!) {
        best = entry;
      }
    }
    if (best !== null) this.current.set(best.centerId, this.current.get(best.centerId)! - total);
    return best;
  }
}

/**
 * 形态判定（方案 2.3 节）：计数必须来自**中心侧登记**，读本机永远得 1
 * （本项目修过的真 bug）。Loom 自立形态不在此判定链上。
 */
import type { ExecutionDomain } from "../policy/security-constants.js";

export type GlobalForm = "standalone" | "combined" | "multi-center";

export function determineForm(registeredCenters: number): GlobalForm {
  if (registeredCenters <= 0) return "standalone";
  if (registeredCenters === 1) return "combined";
  return "multi-center";
}

/**
 * 生效执行域（方案 6.2/6.3 节，拍板一）：三处显示共用的同一个函数——
 * 空间默认 + bot 覆盖；覆盖可空，非空生效。放在契约层，界面只消费结果。
 */
export type { ExecutionDomain } from "../policy/security-constants.js";

export function resolveEffectiveExecutionDomain(
  spaceDefault: ExecutionDomain,
  botOverride: ExecutionDomain | null | undefined,
): { domain: ExecutionDomain; source: "inherited" | "override" } {
  return botOverride != null
    ? { domain: botOverride, source: "override" }
    : { domain: spaceDefault, source: "inherited" };
}
