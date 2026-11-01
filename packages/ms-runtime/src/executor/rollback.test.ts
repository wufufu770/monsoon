import { describe, expect, it } from "vitest";
import { applyRollback, planRollback } from "./rollback.js";

describe("回滚分支（步骤七收尾）", () => {
  const capability = {
    supportedActions: ["fs.undo-write"],
    execute: async () => undefined,
  };

  it("reconcile 携带 hint 且工具声明支持 → rollback", async () => {
    const outcome = { callId: "c1", state: "completed" as const, rollbackHint: { action: "fs.undo-write" } };
    const { decision, audit } = await applyRollback(outcome, capability);
    expect(decision.action).toBe("rollback");
    expect(audit.type).toBe("rollback.rollback");
  });

  it("无 hint → none；有 hint 无能力 → 转人工", async () => {
    expect(planRollback({ callId: "c", state: "completed" }, capability).action).toBe("none");
    expect(planRollback({ callId: "c", state: "completed", rollbackHint: { action: "db.undo" } }, capability).action)
      .toBe("manual");
  });

  it("不支持的回滚动作转人工，绝不盲执行", async () => {
    const decision = planRollback({ callId: "c", state: "completed", rollbackHint: { action: "unknown.action" } }, capability);
    expect(decision.action).toBe("manual");
  });
});
