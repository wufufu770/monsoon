/**
 * ms 调度器子进程入口：独立 SQLite 句柄（scheduler.db）+ 事件网关待命。
 * Phase 1 骨架：网关与触发规则表已就绪，派活循环在批次二接线
 * （pi-durable 内核与 Loom 事件源接入后启动消化循环）。
 */
import { openLocalStores } from "@monsoon/ms-runtime/supervisor";
import { EventGateway } from "@monsoon/ms-runtime/scheduler";

const dataDir = process.env.MS_DATA_DIR ?? ".";
const stores = openLocalStores(dataDir);

const gateway = new EventGateway({
  whitelist: [
    { source: "loom", type: "task.queued" },
    { source: "cron", type: "tick" },
  ],
});

// Phase 1 骨架：网关与存储句柄保持存活，等待批次二接线派活循环。
console.log(`[ms-scheduler] ready (dataDir=${dataDir}, whitelist=${gateway ? "loaded" : "missing"})`);

process.on("SIGTERM", () => {
  console.log("[ms-scheduler] SIGTERM, closing stores");
  stores.close();
  process.exit(0);
});
setInterval(() => undefined, 1 << 30); // 保持事件循环存活
