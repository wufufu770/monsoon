import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  openExecutorKernel,
  projectCenterLedger,
  reconcileWithCenterLedger,
  toolReplayPolicy,
  type SideEffectCheckpoint,
} from "./durable.js";

describe("replay-safe 判定（步骤二.3）", () => {
  it("readOnly 且联网 none/declared 才是 safe", () => {
    expect(toolReplayPolicy({ readOnly: true, networkAccess: "none" })).toBe("safe");
    expect(toolReplayPolicy({ readOnly: true, networkAccess: "declared" })).toBe("safe");
  });

  it("验收项：readOnly=true 但 undeclared 不被标记为 replay-safe", () => {
    expect(toolReplayPolicy({ readOnly: true, networkAccess: "undeclared" })).toBe("unsafe");
    expect(toolReplayPolicy({ readOnly: true })).toBe("unsafe");
    expect(toolReplayPolicy({ readOnly: false, networkAccess: "none" })).toBe("unsafe");
  });
});

describe("恢复对账（步骤二.4，中心账本为准）", () => {
  const checkpoint: SideEffectCheckpoint = {
    callId: "call-1",
    toolName: "fs.write",
    sideEffectLevel: "write",
    registeredAt: "2026-11-02T00:00:00.000Z",
  };

  it("中心无登记行 → 本机回退到登记之前（re-register）", () => {
    const verdict = reconcileWithCenterLedger(checkpoint, { hasRegistration: false, settled: false });
    expect(verdict.verdict).toBe("re-register");
  });

  it("中心已登记未结算 → 不重放，转人工", () => {
    const verdict = reconcileWithCenterLedger(checkpoint, { hasRegistration: true, settled: false });
    expect(verdict.verdict).toBe("wait-human");
  });

  it("中心已登记且结算 → 恢复后继续", () => {
    const verdict = reconcileWithCenterLedger(checkpoint, { hasRegistration: true, settled: true });
    expect(verdict.verdict).toBe("proceed");
  });

  it("从事件流投影中心账本（临时通道，不新增 Loom 端点）", () => {
    const events = [
      { type: "tool.intent", payload: { call_id: "call-1" } },
      { type: "run.created", payload: {} },
      { type: "tool.reconciled", payload: { call_id: "call-1" } },
    ];
    expect(projectCenterLedger(events, "call-1")).toEqual({ hasRegistration: true, settled: true });
    expect(projectCenterLedger(events, "call-other")).toEqual({ hasRegistration: false, settled: false });
  });
});

describe("执行器内核存储（pi-durable@1.4.0 自带 Node SQLite）", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it("打开并跨重启重开同一文件（检查点持久化的存储前提）", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ms-durable-"));
    dirs.push(dir);
    const first = await openExecutorKernel(dir);
    expect(first.storage).toBeDefined();
    await first.close();
    const second = await openExecutorKernel(dir);
    expect(second.storage).toBeDefined();
    await second.close();
  });
});
