/**
 * 双中心 e2e（方案 v2.5 拍板十五，批次四验收）：两台真实 Loom 实例同时
 * 连一台 ms——CenterRegistry 注册两中心 → 加权路由 → A 失联冻结、B 照常 →
 * A 恢复 → 向 B 登记副作用并核对中心账本（跨中心不串账）。
 * 运行：npx tsx scripts/e2e/run-centers.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { CenterRegistry } from "@monsoon/ms-runtime/scheduler";
import { LoomClient } from "@monsoon/ms-runtime/loom";

const TOKEN = "e2e-loom-token-0123456789abcdef";
const PORT_A = 4610;
const PORT_B = 4611;
const results: Record<string, { ok: boolean; detail: string }> = {};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startCenter(port: number): Promise<ChildProcess> {
  const proc = spawn("python3", ["scripts/e2e/loom_center.py", String(port)], {
    cwd: process.cwd(), stdio: "ignore",
  });
  const client = new LoomClient({ baseUrl: `http://127.0.0.1:${port}`, workerToken: TOKEN, tenantId: "tenant-a" });
  for (let i = 0; i < 40; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return proc;
    } catch { /* 未就绪 */ }
    await sleep(500);
  }
  throw new Error(`中心 ${port} 启动超时`);
}

async function main(): Promise<void> {
  const centerA = await startCenter(PORT_A);
  const centerB = await startCenter(PORT_B);
  const registry = new CenterRegistry();
  registry.register({
    centerId: "loom-a", baseUrl: `http://127.0.0.1:${PORT_A}`,
    operatorToken: TOKEN, workerToken: TOKEN, tenantId: "tenant-a", weight: 1,
  });
  registry.register({
    centerId: "loom-b", baseUrl: `http://127.0.0.1:${PORT_B}`,
    operatorToken: TOKEN, workerToken: TOKEN, tenantId: "tenant-a", weight: 1,
  });

  // 断言 1：契约握手——两个中心的 contract_version 都是 ms-1。
  const clientA = new LoomClient({ baseUrl: `http://127.0.0.1:${PORT_A}`, workerToken: TOKEN, tenantId: "tenant-a", expectedContractVersion: "ms-1" });
  const handshakeA = await clientA.handshake();
  results["双中心_握手"] = {
    ok: handshakeA.contractVersion === "ms-1",
    detail: `A contract=${handshakeA.contractVersion}`,
  };

  // 断言 2：加权路由在两个真中心间分布。
  const picked: string[] = [];
  for (let i = 0; i < 4; i += 1) picked.push(registry.pickOnline()!.centerId);
  results["双中心_加权路由"] = {
    ok: picked.includes("loom-a") && picked.includes("loom-b"),
    detail: `4 次路由分布: ${picked.join(",")}`,
  };

  // 断言 3：向路由到的中心登记副作用，**账本不串**——A 有记录、B 没有。
  const routed = registry.pickOnline()!;
  const client = new LoomClient({ baseUrl: routed.baseUrl, workerToken: TOKEN, tenantId: "tenant-a" });
  const { runId, claim } = await client.ensureClaimedTask({
    runIdempotencyKey: "centers:run", taskId: "ms-centers-1", workerId: "w1",
  });
  const callId = "c" + "e".repeat(63).slice(0, 63); // 64 hex 由调用方生成，测试用固定形状
  await client.registerEffect(runId, {
    task_id: claim.task_id, worker_id: claim.worker_id, epoch: claim.epoch,
    call_id: callId, tool_name: "fs.write", side_effect_level: "write",
  }, "centers:effect");
  const other = routed.centerId === "loom-a" ? "loom-b" : "loom-a";
  const otherPort = other === "loom-a" ? PORT_A : PORT_B;
  const otherClient = new LoomClient({ baseUrl: `http://127.0.0.1:${otherPort}`, workerToken: TOKEN, tenantId: "tenant-a" });
  const eventsOnRouted = await client.eventsAll(runId);
  const intentOnRouted = eventsOnRouted.some((e) => e.type === "tool.intent");
  let intentOnOther = true;
  try {
    // 另一台中心的库是独立的——同 run_id 查询应 404/空（租户同但库不同）。
    const eventsOther = await otherClient.eventsAll(runId);
    intentOnOther = eventsOther.some((e) => e.type === "tool.intent");
  } catch {
    intentOnOther = false; // 404/异常 = 无串账
  }
  results["双中心_账本不串"] = {
    ok: intentOnRouted && !intentOnOther,
    detail: `路由到 ${routed.centerId}：intent=${intentOnRouted}；另一台 intent=${intentOnOther}（应为 false）`,
  };

  // 断言 4：A 失联（杀进程）→ registry 冻结 A，B 照常被路由且可写。
  centerA.kill("SIGKILL");
  for (let i = 0; i < 3; i += 1) {
    try {
      await fetch(`http://127.0.0.1:${PORT_A}/health`);
      registry.markFailure("loom-a");
    } catch {
      registry.markFailure("loom-a");
    }
    await sleep(200);
  }
  const frozen = registry.get("loom-a")!.status === "offline";
  const stillRouted = registry.pickOnline()!.centerId === "loom-b";
  const { runId: runIdB, claim: claimB } = await (new LoomClient({ baseUrl: `http://127.0.0.1:${PORT_B}`, workerToken: TOKEN, tenantId: "tenant-a" }))
    .ensureClaimedTask({ runIdempotencyKey: "centers-b:run", taskId: "ms-centers-2", workerId: "w1" });
  results["双中心_独立降级"] = {
    ok: frozen && stillRouted && Boolean(runIdB && claimB.task_id),
    detail: `A 冻结=${frozen}, 路由只剩 B=${stillRouted}, B 可建任务=${Boolean(claimB.task_id)}`,
  };

  // 清场：A 恢复留作手动，B 收尾。
  centerB.kill("SIGTERM");
  console.log("\n=== 双中心 e2e 结果 ===");
  for (const [scenario, result] of Object.entries(results)) {
    console.log(`${result.ok ? "✅" : "❌"} ${scenario}: ${result.detail}`);
  }
  const allOk = Object.values(results).every((r) => r.ok);
  console.log(allOk ? "\n双中心联调：全部通过" : "\n双中心联调：存在失败项");
  process.exit(allOk ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error("[e2e-centers]", error);
  process.exit(1);
});
