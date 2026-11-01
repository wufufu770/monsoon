/**
 * 唤醒预算（方案 v2.5 步骤九，d2d 语义）：多中心来源在滑动窗口内的唤醒次数隔离，
 * 防止单一中心的高频短任务挤占其他中心的调度资源。
 *
 * 超预算的事件在 EventGateway 的 Fast Path 被 **defer**（保留待窗口滑出），
 * 不是 drop——drop 是过滤语义，defer 是资源语义，二者不混。
 */
export interface WakeupBudgetOptions {
  /** 每个来源在窗口内的最大唤醒次数。默认 60。 */
  readonly maxPerSource?: number;
  /** 滑动窗口时长毫秒。默认 60_000。 */
  readonly windowMs?: number;
  /** 时钟注入（测试用）。 */
  readonly now?: () => number;
}

export type WakeupBudgetVerdict = { action: "granted" } | { action: "deferred"; retryAtMs: number };

export class WakeupBudget {
  private readonly maxPerSource: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly hits = new Map<string, number[]>();

  constructor(options: WakeupBudgetOptions = {}) {
    this.maxPerSource = options.maxPerSource ?? 60;
    this.windowMs = options.windowMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  /** 消耗一次唤醒额度。超预算返回 defer 与建议重试时间。 */
  tryAcquire(source: string): WakeupBudgetVerdict {
    const nowMs = this.now();
    const windowStart = nowMs - this.windowMs;
    const list = (this.hits.get(source) ?? []).filter((t) => t > windowStart);
    if (list.length >= this.maxPerSource) {
      const retryAtMs = list[0]! + this.windowMs;
      this.hits.set(source, list);
      return { action: "deferred", retryAtMs };
    }
    list.push(nowMs);
    this.hits.set(source, list);
    return { action: "granted" };
  }
}
