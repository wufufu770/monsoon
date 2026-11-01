/**
 * 事件网关（方案 v2.5 步骤四）：ms 调度器的统一事件接入与两级过滤。
 *
 * 三类事件源：Loom 任务队列轮询结果、本机 cron 触发、外部 webhook
 * （文件变化 watcher、GitHub webhook、IM 消息适配器）。
 *
 * Fast Path（确定性，本模块）：source+type 白名单 → dedup_key 去重
 * （窗口默认 5 分钟）→ 可选唤醒预算 defer。
 * Slow Path（廉价模型通道，可插拔）：按提示词策略判定 action/defer/drop。
 * Phase 1 不做订阅直通（Worker 直接订阅 Thread），只做"网关 + 两级过滤 + Trigger"。
 *
 * 被判 action 的事件交给 onAction 回调（转化为调度器既有的 Trigger 记录）。
 */
import { WakeupBudget } from "./wakeup-budget.js";

export interface GatewayEvent {
  /** 事件源内唯一标识。 */
  readonly id: string;
  /** 事件来源：loom / cron / webhook:<kind> 等。 */
  readonly source: string;
  /** 事件类型（source 内命名空间，如 github.pull_request）。 */
  readonly type: string;
  readonly payload: Record<string, unknown>;
  /** 去重键：同键事件在去重窗口内只通过一次。 */
  readonly dedupKey: string;
  readonly timestamp: number;
}

export type GatewayAction = "action" | "defer" | "drop";

export interface GatewayDecision {
  readonly action: GatewayAction;
  readonly reason: string;
}

/** Slow Path 接口：廉价模型通道按提示词策略判定；确定性默认策略见 defaultSlowPath。 */
export type SlowPath = (event: GatewayEvent) => Promise<GatewayDecision>;

export interface EventGatewayOptions {
  /** source+type 白名单：不在名单内的事件在 Fast Path 被 drop。 */
  readonly whitelist: readonly { source: string; type: string }[];
  /** 去重窗口毫秒，默认 5 分钟。 */
  readonly dedupWindowMs?: number;
  /** 每来源唤醒预算（步骤九）；不传则不做预算 defer。 */
  readonly budget?: WakeupBudget;
  /** Slow Path；缺省为确定性放行（Phase 1 未接廉价模型通道时的合法状态）。 */
  readonly slowPath?: SlowPath;
  readonly now?: () => number;
}

export class EventGateway {
  private readonly whitelist: Set<string>;
  private readonly dedupWindowMs: number;
  private readonly budget: WakeupBudget | undefined;
  private readonly slowPath: SlowPath | undefined;
  private readonly now: () => number;
  private readonly lastSeen = new Map<string, number>();

  constructor(options: EventGatewayOptions) {
    this.whitelist = new Set(options.whitelist.map((w) => `${w.source}#${w.type}`));
    this.dedupWindowMs = options.dedupWindowMs ?? 5 * 60_000;
    this.budget = options.budget;
    this.slowPath = options.slowPath;
    this.now = options.now ?? Date.now;
  }

  /**
   * 摄入一个事件并给出判定。判定为 action 时回调 onAction（转 Trigger）。
   * 同步 Fast Path + 异步 Slow Path：整体幂等于同一事件的重复摄入（dedup）。
   */
  async ingest(
    event: GatewayEvent,
    onAction?: (event: GatewayEvent) => void,
  ): Promise<GatewayDecision> {
    // Fast Path 一：白名单。
    if (!this.whitelist.has(`${event.source}#${event.type}`)) {
      return { action: "drop", reason: `source/type 不在白名单: ${event.source}#${event.type}` };
    }
    // Fast Path 二：dedup（窗口内的同 dedupKey 只通过一次；过期键顺带清理）。
    const nowMs = this.now();
    for (const [key, seen] of this.lastSeen) {
      if (nowMs - seen > this.dedupWindowMs) this.lastSeen.delete(key);
    }
    const seenAt = this.lastSeen.get(event.dedupKey);
    if (seenAt !== undefined) {
      return { action: "drop", reason: `dedup 窗口内重复: ${event.dedupKey}` };
    }
    this.lastSeen.set(event.dedupKey, nowMs);
    // Fast Path 三：唤醒预算（defer 保留事件，不占用去重——窗口滑出后可重新摄入）。
    if (this.budget) {
      const verdict = this.budget.tryAcquire(event.source);
      if (verdict.action === "deferred") {
        return { action: "defer", reason: `唤醒预算耗尽，建议 ${verdict.retryAtMs} 后重试` };
      }
    }
    // Slow Path：可插拔策略判定。
    if (this.slowPath) {
      const decision = await this.slowPath(event);
      if (decision.action !== "action") {
        return { action: decision.action, reason: `slowPath: ${decision.reason}` };
      }
    }
    onAction?.(event);
    return { action: "action", reason: "fast path 通过" };
  }
}
