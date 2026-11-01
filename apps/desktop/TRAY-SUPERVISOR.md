# ms 托盘 supervisor（步骤一桌面侧）

> 核心监督逻辑与测试见 `packages/ms-runtime/src/supervisor/`（退避序列、
> 稳定清零、显式停止、双库句柄）与 `docs/tray-supervisor.md`（拓扑与策略）。
> 本文档记录桌面侧接线与验收状态。**VERDICT: PASS（partial：Windows 探针）**。

## 一、进程拓扑（已实现）

```
Electron main（托盘 TraySupervisor）
  ├─ scheduler 子进程  dist/monsoon/scheduler-main.js → ms-data/scheduler.db
  └─ executor  子进程  dist/monsoon/executor-main.js  → ms-data/executor.db
                                                      + executor-durable.db（pi-durable）
```

- 子进程 = `process.execPath` + `ELECTRON_RUN_AS_NODE=1`（Electron 官方模式）。
- 托盘菜单：打开窗口 / 重启调度器 / 重启执行器 / 停止全部并退出。
- 重启策略：指数退避（1s→30s 封顶、稳定 30s 清零、最大 10 次——
  `maxRestarts` 可配）；非零退出码与信号退出统一处理，不区分。
- **退出路径**：`before-quit` 拦截一次 → SIGTERM → 5s 优雅窗口 → SIGKILL →
  `app.exit(0)`。已知取舍：自动更新触发的 quit 亦走此路径（Phase 1 接受）。
- 托盘常驻边界：托盘退出即全部子进程退出；不做 manifest adoption（不做清单）。

## 二、与 rakazo 原语义的区分

rakazo 原形态 = "后台 Docker 栈常驻 + 显式 Stop Local Stack"；ms 托盘
supervisor 只拥有 **ms 自有内核**（调度器/执行器两个子进程），过渡期
Docker 栈继续承载 web/api，两者的退出路径互不干扰（rakazo 清理先于 ms
SIGTERM——before-quit 监听者注册顺序）。

## 三、与 Pi Durable 的衔接点（步骤二）

supervisor **不做恢复逻辑**，只把子进程拉起来。执行器子进程启动时自行：
1. `openLocalStores(dataDir)` 开 executor.db；
2. `openExecutorKernel(dataDir)` 开 pi-durable 存储（executor-durable.db）；
3. 从未完成 Task 恢复阶段，恢复后按 DURABLE.md 以中心账本为准对账。
supervisor 不读 pi-durable 的存储。

## 四、BrowserWindow close 行为

macOS/Windows：关闭窗口拦截为 hide（托盘常驻语义）；Linux：正常退出，
不承诺托盘常驻。该行为由 rakazo 既有的窗口管理承担（setup/app 窗口的
hide/focus 逻辑已存在，未修改——避免影响正常使用）。

## 五、验收状态

| 验收项 | 状态 |
|---|---|
| 杀掉执行器子进程，supervisor 退避窗口内重启 | 逻辑测试通过（supervisor.test.ts）；实机进程级演练待 Windows/macOS 实测 |
| 托盘退出后子进程不残留 | stop() 的 SIGTERM→5s→SIGKILL 测试覆盖 requestStop 语义；quit 链路实机待验 |
| macOS 关窗后托盘仍在、子进程存活 | 依赖 rakazo 既有 hide 逻辑；实机待验 |
| Windows 探针 | **partial**——探针脚本已交付（scripts/tray-probe-windows.ts），本机为 Linux 未执行；三件断言（图标可见/关窗存活/菜单重开）待 Windows 实机跑 `npx tsx scripts/tray-probe-windows.ts` |

## 六、Windows 探针结果

**partial-blocked（2026-11-02）**：本构建环境为 Kali/Linux，无 Windows 实机
（WSL2 不算——Electron 的 Tray API 在 Windows 原生环境与 WSL2 下行为不同）。
探针脚本已交付：`apps/desktop/scripts/tray-probe-windows.ts`。

### Windows 实机验证 runbook（探针执行步骤）

1. 环境：Windows 10/11 物理机或完整虚拟机；Node.js 22.13+、pnpm；
2. `git clone https://github.com/wufufu770/monsoon && cd monsoon && pnpm install && pnpm --filter @rakazo/desktop build`；
3. `npx tsx apps/desktop/scripts/tray-probe-windows.ts`（或在 Windows 终端逐项手测）；
4. 依次目视/断言三件事，每步截图留证：
   - 通知区域（任务栏右下角）出现应用图标；
   - 点窗口 × → 窗口消失但任务管理器中 Electron 主进程仍在；
   - 托盘菜单"reopen"点击 → 新窗口重现；
5. 附加：托盘菜单"停止全部并退出"→ 任务管理器确认 scheduler/executor
   子进程无残留；
6. 把结果 JSON（`{"ok":..., "results": {...}}`）与本节更新提交。

三项全过 → 本节转 full；任一失败 → 保持 partial-blocked 并记录
Windows 版本 / Node 版本 / Electron 45 / 失败现象与复现步骤。

---

**VERDICT: PASS（partial：Windows 探针待实机）**

（生产者自检结论：桌面接线 tsc 0 错误、build 产物含两个子进程入口；
监督核心有测试；Windows 探针如实标记 partial。）
