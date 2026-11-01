/**
 * e2e 执行器子进程入口：按环境变量配置，跑 ExecutorLoop 直至 SIGKILL/SIGTERM。
 *
 * 环境变量：MS_DATA_DIR、MS_E2E_LOOM_URL、MS_E2E_LOOM_TOKEN、MS_E2E_SLOW_MS。
 * 工具集：echo.read（只读）+ mock.append（write 级慢副作用，写计数文件，
 * 执行后滞留 wait-reconcile——给 kill -9 留出窗口）。
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { openLocalStores } from "@monsoon/ms-runtime/supervisor";
import { ExecutorLoop, type ExecutorTool } from "@monsoon/ms-runtime/executor";
import { LoomClient } from "@monsoon/ms-runtime/loom";
const dataDir = process.env.MS_DATA_DIR ?? ".";
const counterFile = path.join(dataDir, "mock-counter.json");

function bumpCounter(): number {
  const current = existsSync(counterFile)
    ? (JSON.parse(readFileSync(counterFile, "utf8")) as { count: number }).count
    : 0;
  const next = current + 1;
  mkdirSync(path.dirname(counterFile), { recursive: true });
  writeFileSync(counterFile, JSON.stringify({ count: next }));
  return next;
}

const slowMs = Number(process.env.MS_E2E_SLOW_MS ?? 8_000);
const tools: ExecutorTool[] = [
  {
    name: "echo.read",
    description: "只读回声",
    inputSchema: { type: "object" },
    readOnly: true,
    networkAccess: "none",
    sideEffectLevel: "read",
    execute: async (args) => ({ echoed: args }),
  },
  {
    name: "mock.append",
    description: "模拟不可逆追加写：立即写计数文件，再滞留 slowMs 供 kill -9 窗口",
    inputSchema: { type: "object" },
    readOnly: false,
    networkAccess: "none",
    sideEffectLevel: "write",
    execute: async () => {
      const count = bumpCounter();
      console.log(`[ms-executor] mock.append 已写第 ${count} 次，滞留 ${slowMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, slowMs));
      return { count };
    },
  },
];

const stores = openLocalStores(dataDir);
const loomUrl = process.env.MS_E2E_LOOM_URL;
const loom = loomUrl
  ? new LoomClient({ baseUrl: loomUrl, token: process.env.MS_E2E_LOOM_TOKEN ?? "", tenantId: "tenant-a" })
  : undefined;

const events: { type: string; payload: Record<string, unknown> }[] = [];
const loop = new ExecutorLoop({
  scheduler: stores.scheduler,
  executor: stores.executor,
  workerId: process.env.MS_WORKER_ID ?? "w1",
  tools,
  loom,
  pollIntervalMs: Number(process.env.MS_POLL_MS ?? 500),
  loomTenantHomeDir: process.env.HOME,
  onEvent: (event) => {
    events.push(event);
    // 审计事件持久化（入链形态的最小落地：逐行 JSON，供 e2e 断言与重启恢复）。
    writeFileSync(path.join(dataDir, "executor-audit.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n"));
    console.log(`[ms-executor] ${event.type}`);
  },
});
void loop.recover()
  .then((recoveries) => {
    for (const recovery of recoveries) console.log(`[ms-executor] recovery: ${JSON.stringify(recovery)}`);
    loop.start();
    console.log("[ms-executor] loop started");
  })
  .catch((error: unknown) => {
    // 恢复失败不崩进程：网关循环照常起，未完成检查点留待下次启动再对账。
    console.error("[ms-executor] recovery error（继续启动循环）", error);
    loop.start();
    console.log("[ms-executor] loop started（降级）");
  });

process.on("SIGTERM", () => {
  stores.close();
  process.exit(0);
});
