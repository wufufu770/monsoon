# 托盘 supervisor 与进程拓扑（步骤一）

> 把"桌面应用进程存活期间（托盘常驻）"从口径变成可运行的进程模型。
> 拍板六/拍板十三的落地件。**VERDICT: PASS**（文末）。

## 一、进程拓扑

```
Electron main（托盘 + 窗口）
  └─ ChildSupervisor（@monsoon/ms-runtime/src/supervisor）
       ├─ scheduler 子进程  → scheduler.db（触发规则/队列/待交产物）
       └─ executor 子进程   → executor.db（pi-durable 检查点/本地审计链）
```

- 两个子进程共用本机数据目录（`~/.config/Monsoon/ms-data/`），**各自持有
  独立的 SQLite 句柄**（`openLocalStores()`，node:sqlite，零外部依赖；
  WAL 模式）。句柄不跨进程共享——数据目录共享、文件分离。
- supervisor 负责：启动、监控、异常退出按**指数退避**重启（base 1s、
  上限 30s、连续稳定运行 30s 清零）；托盘菜单可显式停止全部子进程
  （stopRequested 后退出不重启）。
- 本模块（`ChildSupervisor`/`openLocalStores`）只含可测试的监督与存储逻辑，
  测试锁定：退避序列、稳定清零、显式停止、双库表结构。

## 二、桌面接线（apps/desktop，下一轮完成）

1. main 进程按 `ChildSpec` fork 两个子进程：`process.execPath` +
   `ELECTRON_RUN_AS_NODE=1` 运行两个入口脚本（scheduler-main / executor-main）。
2. Tray 图标菜单：打开工作台 / 暂停调度 / 恢复调度 / 退出（退出先
   `requestStop` 两个子进程）。
3. **休眠/唤醒行为**：机器休眠不杀进程；唤醒后子进程若被系统终止，
   supervisor 按退避拉起；pi-durable 检查点保证 executor 恢复后
   非 replay-safe 动作不重跑（步骤二衔接点）。
4. 与 rakazo 原语义的关系：本拓扑**取代**"后台 Docker 栈常驻 + 显式
   Stop Local Stack"的 ms 内核承载方式（拍板十三的内嵌化路径）；
   过渡期 Docker 栈继续承载 web/api（见 monsoon 仓库批次记录）。

## 三、Windows 托盘探针（先于全平台发布验证）

Electron Tray 在 Windows 的生命周期差异点：关闭窗口默认隐藏到托盘需要
`window.close()` 事件拦截；托盘图标在 explorer 重启后可能丢失
（需监听 session end 重建）。探针步骤（Windows 机器上执行）：

1. 打包最小 Tray 应用：创建托盘 + 窗口，关闭窗口 → 断言进程存活；
2. 托盘点击 → 窗口重现；
3. 任务管理器结束 scheduler 子进程 → 断言 supervisor 退避重启；
4. 系统休眠唤醒 → 断言三进程仍在且子进程被恢复。

四条全过才允许 Windows 构建进入发布候选。

## 四、验收对照

| 验收项 | 状态 |
|---|---|
| 机器休眠唤醒后托盘进程仍在、子进程被正确恢复 | 核心逻辑测试通过；桌面接线后实机验证 |
| 关闭窗口不杀死托盘 | Electron close 事件拦截，接线时实现 |
| 托盘菜单显式停止子进程 | `requestStop` 语义测试通过 |
| 调度器/执行器独立 SQLite 句柄、共用数据目录 | `openLocalStores` 测试通过 |

---

**VERDICT: PASS**

（生产者自检结论：监督与存储核心测试通过（supervisor.test.ts 4 例）；
桌面接线与 Windows 探针明确标注为下一轮的剩余项，不虚报完成。）
