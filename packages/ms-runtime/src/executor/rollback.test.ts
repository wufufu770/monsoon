import { describe, expect, it } from "vitest";
import { AuditChain } from "../policy/audit-chain.js";
import { handleReconcileRollback, rollbackCallId, type RollbackContext } from "./rollback.js";

function makeContext(overrides: Partial<RollbackContext> = {}): { context: RollbackContext; registered: string[] } {
  const registered: string[] = [];
  const context: RollbackContext = {
    audit: new AuditChain(),
    registerSideEffect: async (input) => {
      registered.push(input.callId);
    },
    executeRollback: async () => undefined,
    ...overrides,
  };
  return { context, registered };
}

describe("回滚分支（步骤七收尾，v3 契约）", () => {
  const hint = { callId: "ms-1:run:task:1", toolName: "fs.write", reason: "结算发现越界写入" };

  it("声明 rollback 且收到 hint：登记新 call_id + 三段审计事件（验收项）", async () => {
    const { context, registered } = makeContext();
    const outcome = await handleReconcileRollback(
      { callId: hint.callId, state: "completed", rollbackHint: hint },
      { name: "fs.write", rollback: true },
      context,
    );
    expect(outcome.kind).toBe("rollback_started");
    expect(outcome.rollbackCallId).toBe(rollbackCallId(hint.callId));
    expect(outcome.rollbackCallId).not.toBe(hint.callId);
    expect(registered).toEqual([rollbackCallId(hint.callId)]);
    const types = context.audit.all().map((event) => event.type);
    expect(types).toEqual(["effect.rollback_started", "effect.rollback_completed"]);
    expect(context.audit.verify().ok).toBe(true);
  });

  it("未声明 rollback：不执行、写 rollback_unsupported 并转人工（验收项）", async () => {
    const { context, registered } = makeContext();
    const outcome = await handleReconcileRollback(
      { callId: hint.callId, state: "completed", rollbackHint: hint },
      { name: "fs.write", rollback: false },
      context,
    );
    expect(outcome.kind).toBe("rollback_unsupported");
    expect(registered).toEqual([]);
    expect(context.audit.all().map((event) => event.type)).toEqual(["effect.rollback_unsupported"]);
  });

  it("回滚执行失败：rollback_failed 入链，不静默", async () => {
    const { context } = makeContext({
      executeRollback: async () => {
        throw new Error("undo I/O error");
      },
    });
    const outcome = await handleReconcileRollback(
      { callId: hint.callId, state: "completed", rollbackHint: hint },
      { name: "fs.write", rollback: true },
      context,
    );
    expect(outcome.kind).toBe("rollback_failed");
    expect(context.audit.all().map((event) => event.type)).toEqual([
      "effect.rollback_started", "effect.rollback_failed",
    ]);
  });

  it("无 hint：不产生任何审计事件", async () => {
    const { context } = makeContext();
    const outcome = await handleReconcileRollback(
      { callId: "c", state: "completed" },
      { name: "fs.write", rollback: true },
      context,
    );
    expect(outcome.kind).toBe("none");
    expect(context.audit.all()).toHaveLength(0);
  });

  it("回滚自身登记的 call_id 派生规则：与原始绑定且不同", () => {
    expect(rollbackCallId("ms-1:run:task:1")).toBe("ms-1:run:task:1:rollback");
  });
});
