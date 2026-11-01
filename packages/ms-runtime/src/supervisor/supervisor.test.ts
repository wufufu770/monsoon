import { describe, expect, it } from "vitest";
import { backoffDelayMs, ChildSupervisor } from "./supervisor.js";
import { openLocalStores } from "./storage.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("托盘 supervisor（步骤一）", () => {
  it("退避延迟：指数增长并封顶", () => {
    expect(backoffDelayMs(0, { baseMs: 1000, maxMs: 30000 })).toBe(1000);
    expect(backoffDelayMs(1, { baseMs: 1000, maxMs: 30000 })).toBe(2000);
    expect(backoffDelayMs(3, { baseMs: 1000, maxMs: 30000 })).toBe(8000);
    expect(backoffDelayMs(10, { baseMs: 1000, maxMs: 30000 })).toBe(30000);
  });

  it("子进程退出：未请求停止则安排重启，稳定运行清零退避", () => {
    let now = 100_000;
    const supervisor = new ChildSupervisor({ now: () => now });
    supervisor.register({ name: "scheduler", command: "node", args: ["scheduler.mjs"] });

    // 立即崩溃：第一次退避 1s，第二次 2s。
    expect(supervisor.onChildExit("scheduler")).toEqual({ restart: true, delayMs: 1000 });
    now += 500; // 未达稳定阈值
    expect(supervisor.onChildExit("scheduler")).toEqual({ restart: true, delayMs: 2000 });
    supervisor.markRunning("scheduler");
    // 稳定运行 30s 后清零。
    now += 31_000;
    expect(supervisor.onChildExit("scheduler")).toEqual({ restart: true, delayMs: 1000 });
  });

  it("托盘显式停止后不再重启", () => {
    const supervisor = new ChildSupervisor({});
    supervisor.register({ name: "executor", command: "node" });
    supervisor.requestStop("executor");
    expect(supervisor.onChildExit("executor")).toEqual({ restart: false, delayMs: 0 });
    expect(supervisor.status().find((s) => s.name === "executor")?.state).toBe("stopped");
  });
});

describe("本机 SQLite 存储句柄（步骤一）", () => {
  it("调度器与执行器各自独立句柄，共用数据目录，表结构就绪", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ms-stores-"));
    try {
      const stores = openLocalStores(dir);
      stores.scheduler.prepare(
        "INSERT INTO triggers (id, kind, spec, template, enabled) VALUES (?, ?, ?, ?, 1)")
        .run("t1", "interval", "{}", "echo.read");
      stores.executor.prepare(
        "INSERT INTO checkpoints (id, snapshot, updated_at) VALUES (?, ?, ?)")
        .run("task-1", "{}", Date.now());
      const row = stores.scheduler.prepare("SELECT template FROM triggers WHERE id=?").get("t1") as
        { template: string };
      expect(row.template).toBe("echo.read");
      const ck = stores.executor.prepare("SELECT id FROM checkpoints").get() as { id: string };
      expect(ck.id).toBe("task-1");
      stores.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
