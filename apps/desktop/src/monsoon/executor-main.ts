/**
 * ms 执行器子进程入口：独立 SQLite 句柄 + pi-durable 检查点存储。
 * 启动时自行从未完成 Task 恢复（步骤二）——恢复逻辑在批次二接线
 * （openExecutorKernel 已可用，Harness 派活循环随后接入）。
 */
import { openLocalStores } from "@monsoon/ms-runtime/supervisor";
import { openExecutorKernel } from "@monsoon/ms-runtime/executor";

const dataDir = process.env.MS_DATA_DIR ?? ".";
const stores = openLocalStores(dataDir);

void openExecutorKernel(dataDir)
  .then((kernel) => {
    console.log(`[ms-executor] ready (dataDir=${dataDir}, durable storage opened)`);
    void kernel;
  })
  .catch((error: unknown) => {
    console.error("[ms-executor] durable storage 打开失败", error);
  });

process.on("SIGTERM", () => {
  console.log("[ms-executor] SIGTERM, closing stores");
  stores.close();
  process.exit(0);
});
setInterval(() => undefined, 1 << 30);
