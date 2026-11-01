/** 执行器三明治循环的进程内测试（不 spawn 子进程）。 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AuditChain } from "../policy/audit-chain.js";
import { openLocalStores } from "../supervisor/storage.js";
import { dispatchLocalTask, getLocalTask } from "../scheduler/dispatch.js";
import { ExecutorLoop, type ExecutorTool } from "./loop.js";
import { LoomClient } from "../loom/client.js";

function makeTools(sideEffectFile?: string): ExecutorTool[] {
  const tools: ExecutorTool[] = [{
    name: "echo.read",
    description: "只读回声",
    inputSchema: { type: "object" },
    readOnly: true,
    networkAccess: "none",
    sideEffectLevel: "read",
    execute: async (args) => ({ echoed: args }),
  }];
  if (sideEffectFile) {
    tools.push({
      name: "mock.append",
      description: "模拟不可逆追加写（计数文件）",
      inputSchema: { type: "object" },
      readOnly: false,
      networkAccess: "none",
      sideEffectLevel: "write",
      execute: async () => {
        const current = Number(globalThis.__msMockCount ?? 0) + 1;
        globalThis.__msMockCount = current;
        return { appended: current };
      },
    });
  }
  return tools;
}

declare global {
  // eslint-disable-next-line no-var
  var __msMockCount: number | undefined;
}

describe("执行器三明治循环", () => {
  it("独立形态：echo 任务派活→领取→执行→done，审计链完整", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ms-loop-"));
    const stores = openLocalStores(dir);
    const audit = new AuditChain();
    const loop = new ExecutorLoop({
      scheduler: stores.scheduler, executor: stores.executor,
      workerId: "w1", tools: makeTools(), pollIntervalMs: 10_000,
      onEvent: (e) => audit.append({ type: e.type, actor: "executor", payload: e.payload }),
    });
    const taskId = dispatchLocalTask(stores.scheduler, { template: "echo.read", params: { text: "hi" } });
    const outcome = await loop.tick();
    expect(outcome.kind).toBe("executed");
    const task = getLocalTask(stores.scheduler, taskId);
    expect(task?.status).toBe("done");
    const types = audit.all().map((e) => e.type);
    expect(types).toEqual(["task.claimed", "tool.executed", "task.submitted"]);
    expect(audit.verify().ok).toBe(true);
    stores.close();
  });

  it("proof 拒绝：destructive 等级在本地默认策略下被拦", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ms-loop-"));
    const stores = openLocalStores(dir);
    const tools = makeTools().concat({
      name: "disk.format", description: "格式化", inputSchema: { type: "object" },
      readOnly: false, networkAccess: "none", sideEffectLevel: "irreversible",
      execute: async () => ({}),
    });
    const loop = new ExecutorLoop({
      scheduler: stores.scheduler, executor: stores.executor,
      workerId: "w1", tools, pollIntervalMs: 10_000,
    });
    dispatchLocalTask(stores.scheduler, { template: "disk.format", params: {} });
    const outcome = await loop.tick();
    expect(outcome.kind).toBe("proof-rejected");
    expect(getLocalTask(stores.scheduler, (outcome as { taskId: string }).taskId)?.status).toBe("failed");
    stores.close();
  });

  // 组合形态需要真实 Loom 中心（e2e 脚本会拉起打了 patch 的工作副本）；
  // 单测环境无中心时跳过——ECONNREFUSED 属预期。
  const loomUrl = process.env.MS_E2E_LOOM_URL;
  it.skipIf(loomUrl === undefined)("组合形态：write 工具登记中心意图后 wait-reconcile，恢复对账 wait-human 不重放", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ms-loop-"));
    const stores = openLocalStores(dir);
    const audit = new AuditChain();
    const client = new LoomClient({
      baseUrl: loomUrl!,
      token: process.env.MS_E2E_LOOM_TOKEN ?? "e2e-token",
      tenantId: "tenant-a",
    });
    const loop = new ExecutorLoop({
      scheduler: stores.scheduler, executor: stores.executor,
      workerId: "w1", tools: makeTools(path.join(dir, "count")),
      loom: client, pollIntervalMs: 10_000,
      onEvent: (e) => audit.append({ type: e.type, actor: "executor", payload: e.payload }),
    });
    dispatchLocalTask(stores.scheduler, { template: "mock.append", params: {} });
    const outcome = await loop.tick();
    expect(outcome.kind).toBe("wait-reconcile");
    const callId = (outcome as { callId: string }).callId;
    expect(globalThis.__msMockCount).toBe(1);

    // 恢复对账：中心账本有登记、未结算 → wait-human，不重放。
    const recoveries = await loop.recover();
    expect(recoveries.some((r) => r.verdict === "wait-human")).toBe(true);
    expect(globalThis.__msMockCount).toBe(1);
    const types = audit.all().map((e) => e.type);
    expect(types).toContain("effect.registered");
    expect(types).toContain("recovery.wait-human");
    stores.close();
  });
});
