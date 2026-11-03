/**
 * 首次全链路联调（方案 v2.5 步骤 D）：三场景顺序执行。
 *
 *   场景 1：独立形态——本地 echo 任务派活→执行→done。
 *   场景 2：组合形态——write 工具登记中心意图 → kill -9 执行器 → 重启恢复
 *           → 断言副作用不重放（计数==1）且转人工。
 *   场景 3：Loom 不可达——任务留队不产生重复；恢复后补交成功。
 *
 * 运行：npx tsx scripts/e2e/run.ts   （先起 scripts/e2e/loom_center.py）
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { openLocalStores } from "@monsoon/ms-runtime/supervisor";
import { dispatchLocalTask, getLocalTask } from "@monsoon/ms-runtime/scheduler";
import { LoomClient } from "@monsoon/ms-runtime/loom";

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..");
const DATA = path.join(ROOT, "artifacts", "e2e-data");
const LOOM_URL = "http://127.0.0.1:4610";
const LOOM_TOKEN = "e2e-loom-token-0123456789abcdef";
const results: Record<string, { ok: boolean; detail: string }> = {};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(fn: () => boolean, timeoutMs: number, what: string): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await sleep(250);
  }
  console.error(`  [timeout] ${what}`);
  return false;
}

function spawnExecutor(env: Record<string, string>): ChildProcess {
  const child = spawn("node", ["--import", "tsx", "scripts/e2e/executor-child.ts"], {
    cwd: ROOT,
    env: { ...process.env, MS_DATA_DIR: DATA, ...env },
    stdio: ["ignore", "inherit", "inherit"],
  });
  return child;
}

async function main(): Promise<void> {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });
  const stores = openLocalStores(DATA);

  // ============ 场景 1：独立形态 ============
  console.log("\n=== 场景 1：独立形态（echo 任务）===");
  {
    const taskId = dispatchLocalTask(stores.scheduler, {
      template: "echo.read", params: { text: "hello monsoon" }, requestedBy: "e2e",
    });
    const executor = spawnExecutor({});
    const done = await waitUntil(() => {
      const task = getLocalTask(stores.scheduler, taskId);
      return task?.status === "done";
    }, 20_000, "echo 任务完成");
    executor.kill("SIGTERM");
    const task = getLocalTask(stores.scheduler, taskId);
    const auditText = existsSync(path.join(DATA, "executor-audit.jsonl"))
      ? readFileSync(path.join(DATA, "executor-audit.jsonl"), "utf8") : "";
    const chainOk = auditText.includes("task.claimed")
      && auditText.includes("tool.executed") && auditText.includes("task.submitted");
    results["场景1_独立形态"] = {
      ok: done && task?.status === "done" && chainOk,
      detail: `done=${done}, audit完整=${chainOk}, result=${task?.result ?? "无"}`,
    };
  }

  // ============ 场景 2：组合形态 + kill -9 ============
  console.log("\n=== 场景 2：组合形态（write 登记 → kill -9 → 恢复不重放）===");
  {
    // 先清 4610（场景 3 的 fuser 兜底之外，本场景自己管好端口）。
    spawn("fuser", ["-k", "4610/tcp"]);
    await sleep(1_000);
    // 起打了 patch 的 Loom 中心，确认就绪后才派活（时序：中心先于执行器）。
    const loomCenter = spawn("python3", ["scripts/e2e/loom_center.py"], { cwd: ROOT, stdio: "inherit" });
    const loomUp = await waitUntil(async () => {
      try {
        const probe = await fetch(`${LOOM_URL}/health`);
        return probe.ok;
      } catch {
        return false;
      }
    }, 30_000, "Loom 中心启动");
    if (!loomUp) throw new Error("Loom 中心未能启动");
    const loom = new LoomClient({ baseUrl: LOOM_URL, workerToken: LOOM_TOKEN, tenantId: "tenant-a" });

    // 中心就绪后再起执行器并派活。
    const executor = spawnExecutor({
      MS_E2E_LOOM_URL: LOOM_URL, MS_E2E_LOOM_TOKEN: LOOM_TOKEN,
      MS_E2E_SLOW_MS: "8000", MS_WORKER_ID: "w1",
    });
    await sleep(1_500);
    const taskId = dispatchLocalTask(stores.scheduler, {
      template: "mock.append", params: {}, requestedBy: "e2e",
    });

    // 等执行器把副作用登记进中心账本（审计文件出现 effect.registered，
    // 并从中取 centerRunId 供中心账本核验）。
    let registered = false;
    let runId: string | null = null;
    for (let i = 0; i < 40 && !registered; i += 1) {
      await sleep(500);
      const auditText = existsSync(path.join(DATA, "executor-audit.jsonl"))
        ? readFileSync(path.join(DATA, "executor-audit.jsonl"), "utf8") : "";
      if (auditText.includes("effect.registered")) {
        registered = true;
        const line = auditText.split("\n").find((l) => l.includes("effect.registered"));
        if (line) runId = (JSON.parse(line) as { payload: { centerRunId: string } }).payload.centerRunId;
      }
    }

    // 等执行器真正执行副作用（计数文件出现）。
    const executed = await waitUntil(() => {
      return existsSync(path.join(DATA, "mock-counter.json"));
    }, 20_000, "副作用执行");
    const countBeforeKill = executed
      ? (JSON.parse(readFileSync(path.join(DATA, "mock-counter.json"), "utf8")) as { count: number }).count
      : 0;

    // kill -9 执行器（精确 PID，不杀错）。
    console.log(`  [kill -9] 执行器 PID=${executor.pid}（副作用已执行 ${countBeforeKill} 次，未结算）`);
    executor.kill("SIGKILL");
    await sleep(1_000);

    // 重启执行器（新世代，同数据目录）。
    const executor2 = spawnExecutor({
      MS_E2E_LOOM_URL: LOOM_URL, MS_E2E_LOOM_TOKEN: LOOM_TOKEN, MS_E2E_SLOW_MS: "8000",
      MS_WORKER_ID: "w1",
    });
    await sleep(12_000);
    executor2.kill("SIGTERM");

    // 断言：副作用没有被第二次执行；中心账本 intent 未结算；本地任务转 wait-human。
    const countAfterRecovery = existsSync(path.join(DATA, "mock-counter.json"))
      ? (JSON.parse(readFileSync(path.join(DATA, "mock-counter.json"), "utf8")) as { count: number }).count
      : 0;
    const task = getLocalTask(stores.scheduler, taskId);
    const auditText = existsSync(path.join(DATA, "executor-audit.jsonl"))
      ? readFileSync(path.join(DATA, "executor-audit.jsonl"), "utf8") : "";
    let centerIntent = false;
    if (runId !== null) {
      const events = await loom.eventsAll(runId);
      centerIntent = events.some((e) => e.type === "tool.intent");
    }
    results["场景2_崩溃恢复"] = {
      ok: registered && executed && countBeforeKill === 1 && countAfterRecovery === 1
        && centerIntent && auditText.includes("recovery.wait-human"),
      detail: `登记=${registered}, 执行=${executed}, 执行次数 ${countBeforeKill}→${countAfterRecovery}（必须=1）, `
        + `中心intent=${centerIntent}, 恢复转人工=${auditText.includes("recovery.wait-human")}`,
    };
    loomCenter.kill("SIGTERM");
  }

  // ============ 场景 3：Loom 不可达 ============
  console.log("\n=== 场景 3：Loom 不可达 → 恢复 ===");
  {
    // 先彻底清掉 4610 上的任何中心实例（含预启的）。
    spawn("fuser", ["-k", "4610/tcp"]);
    await waitUntil(async () => {
      try {
        return !(await fetch(`${LOOM_URL}/health`)).ok;
      } catch {
        return true;
      }
    }, 15_000, "中心确认不可达");
    const executor = spawnExecutor({
      MS_E2E_LOOM_URL: LOOM_URL, MS_E2E_LOOM_TOKEN: LOOM_TOKEN, MS_POLL_MS: "300",
    });
    const taskId = dispatchLocalTask(stores.scheduler, {
      template: "mock.append", params: {}, requestedBy: "e2e",
    });
    await sleep(6_000);
    const during = getLocalTask(stores.scheduler, taskId);
    // 中心不可达时执行器不应把任务标记 done。
    const notDoneWhileDown = during?.status !== "done";
    executor.kill("SIGTERM");

    // 恢复中心。
    const loomCenter = spawn("python3", ["scripts/e2e/loom_center.py"], { cwd: ROOT, stdio: "inherit" });
    await waitUntil(async () => {
      try {
        return (await fetch(`${LOOM_URL}/health`)).ok;
      } catch {
        return false;
      }
    }, 30_000, "Loom 恢复");
    const executor2 = spawnExecutor({
      MS_E2E_LOOM_URL: LOOM_URL, MS_E2E_LOOM_TOKEN: LOOM_TOKEN, MS_E2E_SLOW_MS: "0",
      MS_WORKER_ID: "w1",
    });
    const recovered = await waitUntil(() => {
      const task = getLocalTask(stores.scheduler, taskId);
      return task?.status === "done" || task?.status === "failed";
    }, 45_000, "恢复后任务终结");
    const after = getLocalTask(stores.scheduler, taskId);
    executor2.kill("SIGTERM");
    loomCenter.kill("SIGTERM");
    // write 工具恢复后的正确终态：failed + waitReconcile=true（已登记已执行，
    // 等待中心操作员结算——不是 done，也不是永远 queued）。
    let waitReconcile = false;
    if (after?.result) {
      try {
        waitReconcile = (JSON.parse(after.result) as { waitReconcile?: boolean }).waitReconcile === true;
      } catch { /* 非 JSON 结果不判定 */ }
    }
    results["场景3_网络中断"] = {
      ok: notDoneWhileDown && recovered && after?.status === "failed" && waitReconcile,
      detail: `中断期间不误报完成=${notDoneWhileDown}, 恢复后终结=${recovered}, `
        + `终态=${after?.status}, waitReconcile=${waitReconcile}`,
    };
  }

  stores.close();
  console.log("\n=== 联调结果 ===");
  for (const [scenario, result] of Object.entries(results)) {
    console.log(`${result.ok ? "✅" : "❌"} ${scenario}: ${result.detail}`);
  }
  const allOk = Object.values(results).every((r) => r.ok);
  console.log(allOk ? "\n全链路联调：全部通过" : "\n全链路联调：存在失败项（见上）");
  process.exit(allOk ? 0 : 1);
}

void main();
