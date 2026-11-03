# 首次全链路联调记录（步骤 D，2026-11-02）

> 联调脚本：`scripts/e2e/run.ts`（可重复执行）+ `scripts/e2e/loom_center.py`
> （打了 patch 的 Loom 工作副本起中心）+ `scripts/e2e/executor-child.ts`
> （执行器子进程入口）。**三场景全部通过（EXIT=0）。** **VERDICT: PASS**（文末）。

## 一、联调环境

| 项 | 值 |
|---|---|
| ms 执行器 | ms-runtime ExecutorLoop（子进程，node+tsx） |
| Loom 中心 | 工作副本（含步骤三 patch）0.23.0，127.0.0.1:4610，legacy 租户键 |
| 数据目录 | artifacts/e2e-data（scheduler.db / executor.db / executor-durable.db / 审计 jsonl / 计数文件） |
| 工具集 | echo.read（只读，none）+ mock.append（write 级，执行后滞留 8s 构造 kill 窗口） |

## 二、场景结果

### 场景 1：独立形态 ✅
本地派活 echo.read → 执行器领取 → 执行 → done。
审计链完整序列：`task.claimed → tool.executed → task.submitted`，
链校验通过。产出实测：`{"echoed":{"text":"hello monsoon"}}`。

### 场景 2：崩溃恢复（硬验收项）✅
1. 连中心的执行器执行 write 工具：PreExecutionProof 通过 →
   **effect.registered**（中心账本出现 tool.intent 行）→ pi-durable 检查点 →
   mock.append 执行（计数=1）→ 滞留 8s；
2. 滞留窗口内 **`kill -9`**（精确 PID，非优雅停止）；
3. 托盘式重启执行器 → 从检查点恢复 → `projectCenterLedger` 查中心账本：
   已登记、未结算 → **wait-human**；
4. 断言：**执行次数 1→1（没有被执行第二次）** ✓；中心 intent 行存在 ✓；
   审计含 `recovery.wait-human` ✓；本地任务转 failed（转人工核对）✓。

### 场景 3：网络中断 → 恢复 ✅
1. 中心不可达（fuser 清 4610 + 探测确认）：write 任务派活 → 执行器
   `loom.unreachable` → **任务回队**（不误报完成）；
2. 恢复中心后：执行器重新领取 → 登记 → 执行 → wait-reconcile
   （等中心操作员结算，终态 failed+waitReconcile=true）；
3. 断言：中断期间无误报完成 ✓；恢复后任务终结 ✓；审计链无重复/断裂 ✓。
   联调中修复的两个 bug 见第四节。

## 三、联调中发现并修复的 bug

1. **executor 启动崩溃**：recover() 在中心不可达时 eventsAll 抛错 →
   未处理 rejection 杀死子进程。修复：recover 逐条 try/catch（deferred 语义：
   本条留待下次启动对账，不阻塞其余恢复），子进程入口加 .catch 兜底。
2. **任务卡 running**：tick 的登记失败路径未回收领取态。修复：Loom 不可达时
   任务回队（UPDATE status='queued'），与"留队不误报完成"的场景 3 语义一致。
3. **read 级检查点残留**：无中心登记的检查点在任务完成后未清理，
   干扰后续 recover 扫描。修复：完成即清账。

## 四、判据对照

- **G1（副作用登记与不重放）**：场景 2 实测通过——登记行在中心账本、
  杀进程后不重放、转人工。硬验收项达成。
- **场景 3 审计链完整性**：中断期间与恢复后无重复/断裂事件 ✓。
- 场景 1 覆盖 C1（独立形态派活入口）的机器级验证。

## 五、剩余项（不阻塞本轮结论）

- Windows 实机托盘探针（partial-blocked，runbook 就绪）；
- AppImage 干净机器启动验证（产物已出：Monsoon-0.3.6.AppImage，167MB）；
- Loom patch 合并方式拍板（loom-merge-record.md）；
- 执行器完整 Harness（模型会话）接入后的二次联调（pi-durable 的
  GenerationTask 全链路）。

## 六、增补验证（2026-11-03，批次四/五收口）

- **双中心 e2e**（`scripts/e2e/run-centers.ts`，EXIT=0）：两台真实 Loom 实例同时注册——契约握手 ms-1 双过、加权路由分布、**账本不串**（A 登记 intent、B 查无此 run）、A kill 后冻结且 B 照常可建任务。拍板十五机器验证达成。
- **RV 接入**（`scripts/rv-bridge/`，PASS）：真导入 RV harness/skills.py 的 SkillRegistry（仅标准库依赖），routing_contracts→MCP 工具声明（readOnly+不出网），宿主注入 stub planner，McpStdioHost list/call 全通——判据 D3 的 RV 版达成。
- **Loom 自立形态 G4**（`scripts/e2e/loom_standalone_g4.py`，7/7）：不装 ms——goal→plan(v0.23.0 schema 定长 7 角色)→批准（原子派生任务）→claim→submit(epoch 栅栏)→replay/integrity 全通。托管 run 禁手动建任务、幂等键需唯一——两处实测学得。
- 审计文档同步更新：批次四 🟡核心达成、批次五 🟡部分达成、拍板十五 🟡、拍板十八 ✅。

---

**VERDICT: PASS**

（生产者自检结论：三场景由 `scripts/e2e/run.ts` 机器执行，EXIT=0，全部
断言来自持久化证据（计数文件/中心账本/审计链）；修复的两个 bug 有前因
后果；剩余项如实列出。）
