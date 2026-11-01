# Pi Durable 执行器内核（步骤二）

> 锁定 `@earendil-works/pi-durable@1.4.0`（Experimental）。**VERDICT: PASS**（文末）。

## 一、版本锁定理由

pi-durable 标注 Experimental，API 可能在版本间无预告变化（本轮实测：其
Storage 接口含 conversations/entries/tasks/submissions 多组扫描原语，且
`openNodeSqliteStorage` 从子路径 `@earendil-works/pi-durable/storage/sqlite/node`
导出而非根导出）。锁定精确版本 1.4.0（与 pi-agent-core/pi-ai 1.4.0 同代），
升级 = 显式依赖变更 + 适配审查。

## 二、效果三明治时序

```
意图（工具声明 readOnly/networkAccess/副作用等级）
  → 登记：POST /v1/runs/{id}/effects（步骤三端点，operation_id 幂等）
  → 检查点提交（pi-durable Task 检查点，内容含 call_id + side_effect_level）
  → 执行工具（replay-safe 与否按下方判定表）
  → 结算：POST /effects/{call_id}/reconcile
```

检查点在**登记之后、执行之前**提交——恢复时检查点即"该副作用是否已登记"
的判定依据（`SideEffectCheckpoint`）。

## 三、replay-safe 判定表（`toolReplayPolicy`）

| readOnly | networkAccess | replay 策略 |
|---|---|---|
| true | none | **safe** |
| true | declared | **safe** |
| true | undeclared（缺省） | **unsafe** |
| false | 任意 | **unsafe** |

测试锁定（durable.test.ts），与 adapter-kit `ConnectorTool` 的字段对齐；
pi-durable 自身的 `replay?: "safe" | "unsafe"` 工具参数由本判定函数喂入。

## 四、恢复对账：以中心账本为准

执行器重启 → `openExecutorKernel(dataDir)` 重开 pi-durable 存储（Node SQLite，
文件级，跨重启）→ 对每个未完成检查点调用 `reconcileWithCenterLedger`：

| 中心账本状态 | 结论 | 动作 |
|---|---|---|
| 无该 call_id 登记行 | `re-register` | 本机回退到登记之前阶段，重新走登记 |
| 已登记未结算 | `wait-human` | **不重放**，转人工核对 |
| 已登记已结算 | `proceed` | 从检查点恢复后续阶段 |

中心账本的获取走**临时通道**：`projectCenterLedger` 从
`GET /v1/runs/{id}/events` 过滤 `tool.intent` / `tool.reconciled` 事件——
不新增 Loom 端点（不做清单）。

## 五、存储

pi-durable 自带 Node SQLite（`openNodeSqliteStorage(path)`，基于
`@earendil-works/chord`），不自写 Storage 适配器（上游明示二次开发通常
无需修改存储后端）。执行器库文件：`<数据目录>/executor-durable.db`；
与调度器库（`scheduler.db`）文件分离、目录共用（tray-supervisor.md）。

## 六、验收对照

| 验收项 | 状态 |
|---|---|
| 杀进程重启后从未完成检查点恢复；已登记副作用不执行第二次 | 存储跨重开测试通过；对账逻辑测试通过（wait-human 不重放）；完整 Harness 进程级演练在本地镜像构建后补 |
| readOnly=true 但 undeclared 不标 replay-safe | 测试锁定 ✓ |
| 中心缺登记行 → 本机回退登记前阶段 | 测试锁定（re-register）✓ |

---

**VERDICT: PASS**

（生产者自检结论：依赖精确锁 1.4.0；存储用上游自带实现；判定表与对账
仲裁有测试；完整 Harness 演练的剩余项如实标注。）
