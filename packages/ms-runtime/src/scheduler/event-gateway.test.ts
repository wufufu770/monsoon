import { describe, expect, it } from "vitest";
import { EventGateway, type GatewayEvent } from "./event-gateway.js";
import { WakeupBudget } from "./wakeup-budget.js";

const WHITELIST = [
  { source: "loom", type: "task.queued" },
  { source: "cron", type: "tick" },
  { source: "webhook:github", type: "pull_request" },
];

function event(overrides: Partial<GatewayEvent> = {}): GatewayEvent {
  return {
    id: overrides.id ?? "e1",
    source: overrides.source ?? "loom",
    type: overrides.type ?? "task.queued",
    payload: overrides.payload ?? {},
    dedupKey: overrides.dedupKey ?? "loom:task:1",
    timestamp: overrides.timestamp ?? Date.now(),
    ...overrides,
  };
}

describe("事件网关（步骤四）", () => {
  it("白名单外的事件被 drop", async () => {
    const gateway = new EventGateway({ whitelist: WHITELIST });
    const decision = await gateway.ingest(event({ source: "webhook:github", type: "issue" }));
    expect(decision.action).toBe("drop");
  });

  it("白名单内的事件走 action 并回调转 Trigger", async () => {
    const gateway = new EventGateway({ whitelist: WHITELIST });
    let triggered: GatewayEvent | undefined;
    const decision = await gateway.ingest(event(), (e) => {
      triggered = e;
    });
    expect(decision.action).toBe("action");
    expect(triggered?.dedupKey).toBe("loom:task:1");
  });

  it("dedup：同键窗口内只通过一次，异键互不影响", async () => {
    let now = 1_000_000;
    const gateway = new EventGateway({ whitelist: WHITELIST, dedupWindowMs: 5_000, now: () => now });
    expect((await gateway.ingest(event({ dedupKey: "k" }))).action).toBe("action");
    expect((await gateway.ingest(event({ dedupKey: "k" }))).action).toBe("drop");
    expect((await gateway.ingest(event({ dedupKey: "other" }))).action).toBe("action");
    // 窗口滑出后同键可重新通过。
    now += 6_000;
    expect((await gateway.ingest(event({ dedupKey: "k" }))).action).toBe("action");
  });

  it("唤醒预算：超预算 defer 而不是 drop（步骤九）", async () => {
    let now = 2_000_000;
    const budget = new WakeupBudget({ maxPerSource: 2, windowMs: 10_000, now: () => now });
    const gateway = new EventGateway({ whitelist: WHITELIST, budget, now: () => now });
    expect((await gateway.ingest(event({ dedupKey: "a" }))).action).toBe("action");
    expect((await gateway.ingest(event({ dedupKey: "b" }))).action).toBe("action");
    const third = await gateway.ingest(event({ dedupKey: "c" }));
    expect(third.action).toBe("defer");
    // 其他来源不受挤占。
    expect((await gateway.ingest(event({ source: "cron", type: "tick", dedupKey: "d" }))).action).toBe("action");
  });

  it("Slow Path：drop 与 defer 生效且不触发 action 回调", async () => {
    const gateway = new EventGateway({
      whitelist: WHITELIST,
      slowPath: async (e) =>
        e.dedupKey === "noise" ? { action: "drop", reason: "策略判定无关" } : { action: "defer", reason: "稍后" },
    });
    let called = 0;
    expect((await gateway.ingest(event({ dedupKey: "noise" }), () => called++)).action).toBe("drop");
    expect((await gateway.ingest(event({ dedupKey: "later" }), () => called++)).action).toBe("defer");
    expect(called).toBe(0);
  });
});
