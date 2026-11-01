import { describe, expect, it } from "vitest";
import { AuditChain } from "../policy/audit-chain.js";
import { executeWithSandwich, type SandwichDeps } from "./harness-factory.js";
import type { ExecutorTool } from "./loop.js";

const HOME = "/home/tester";
const readTool: ExecutorTool = {
  name: "echo.read", description: "只读回声", inputSchema: { type: "object" },
  readOnly: true, networkAccess: "none", sideEffectLevel: "read",
  execute: async (args) => ({ echoed: args }),
};
const writeTool: ExecutorTool = {
  name: "mock.append", description: "模拟写", inputSchema: { type: "object" },
  readOnly: false, networkAccess: "none", sideEffectLevel: "write",
  execute: async () => ({ appended: 1 }),
};

function makeDeps(overrides: Partial<SandwichDeps> = {}): { deps: SandwichDeps; registered: string[] } {
  const registered: string[] = [];
  const fakeLoom = {
    registerEffect: async (
      _runId: string, body: { call_id: string }, _key: string,
    ) => {
      registered.push(body.call_id);
      return { call_id: body.call_id, status: "registered" };
    },
  } as unknown as SandwichDeps["loom"];
  const deps: SandwichDeps = {
    workerId: "w1", homeDir: HOME, audit: new AuditChain(), loom: fakeLoom,
    ...overrides,
  };
  return { deps, registered };
}

describe("模型会话三明治（步骤 F）", () => {
  it("read 级工具：proof 通过即执行，无登记", async () => {
    const { deps, registered } = makeDeps();
    const outcome = await executeWithSandwich(readTool, { text: "hi" }, deps, "t1");
    expect(outcome.ok).toBe(true);
    expect(outcome.callId).toBeUndefined();
    expect(registered).toEqual([]);
  });

  it("write 级工具连 Loom：登记 callId 后执行（execute 内部完成登记）", async () => {
    const { deps, registered } = makeDeps({
      centerRunId: "run-1", centerTaskId: "ms-t1", centerEpoch: 1,
    });
    const outcome = await executeWithSandwich(writeTool, {}, deps, "t1");
    expect(outcome.ok).toBe(true);
    expect(outcome.callId).toBeDefined();
    expect(registered).toEqual([outcome.callId]);
    const types = deps.audit.all().map((e) => e.type);
    expect(types).toEqual(["effect.registered", "tool.executed"]);
  });

  it("凭证路径绊线命中：不执行、不入登记", async () => {
    const { deps, registered } = makeDeps({
      centerRunId: "run-1", centerTaskId: "ms-t1", centerEpoch: 1,
    });
    const outcome = await executeWithSandwich(writeTool, { path: `${HOME}/.ssh/id_rsa` }, deps, "t1");
    expect(outcome.ok).toBe(false);
    expect(outcome.proofFailures).toContain("credential_tripwire");
    expect(registered).toEqual([]);
    expect(deps.audit.all().map((e) => e.type)).toEqual(["proof.rejected"]);
  });
});
