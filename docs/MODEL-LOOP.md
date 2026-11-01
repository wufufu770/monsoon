# 模型会话循环（步骤 F）

> 代码：`packages/ms-runtime/src/executor/harness-factory.ts`（三明治嵌入
> Harness 工具层）。**VERDICT: PASS（partial：Harness 会话实跑待模型）**（文末）。

## 一、架构判断：三明治嵌在工具执行层

pi-durable 的 Harness 拥有模型循环与工具执行。v4 的三明治（证明 → 登记 →
执行）在 `defineTool` 的 **`execute` 内部**完成（`executeWithSandwich`），
Harness 外面不重复登记。`createExecutorExtension(tools, deps)` 把 ms 工具
包装成 pi-durable extension：`defineTool` 的 `parameters` 取工具声明的
`inputSchema`，`replay` 由 v4 的 `toolReplayPolicy` 直接映射——**不另立判定**。

## 二、replay-safe 映射规则（与 v4 一致）

| readOnly | networkAccess | pi-durable `replay` |
|---|---|---|
| true | none / declared | `safe`（重启后可重跑） |
| true | undeclared（缺省） | `unsafe` |
| false | 任意 | `unsafe` |

`undeclared` 的联网工具即使只读也不允许 replay-safe——这条安全命题在模型
会话下不松动。

## 三、任务定义扩展（向后兼容）

| 任务形状 | 路径 |
|---|---|
| `{ tool_name, params }` | v4 脚本路径（ExecutorLoop.tick），**不回归** |
| `{ instruction, allowed_tools }` | 模型会话：Harness.open(storage, {models, registry}) → root.submit(input) → wait。工具调用发生在 Harness 内部，执行器只负责建立会话、等待、把 settle 状态映射为任务状态 |

## 四、失败降级路径

| 情形 | 处置 |
|---|---|
| 会话超时 | 包装 submission.wait 的超时；超时后中止会话，任务回队或转人工 |
| 工具执行抛错 | execute 返回 isError 结果给模型（模型可自行决定下一步）；最终未完成 → 任务转人工 |
| 模型返回非法 tool_calls | pi-durable 校验拦截 + `repairArgs` 修复常见错误；仍失败 → 会话失败 → 任务回队 |
| 执行器不调用 reconcile | 不变（结算权限在中心操作员）；write 级任务终态 = wait-reconcile / wait-human |

## 五、验收状态

| 验收项 | 状态 |
|---|---|
| instruction 任务：模型选工具、执行前 effects 登记行 | 代码就绪；**实跑待模型**（本机无 Ollama/云端 key，见 MODEL-INTEGRATION.md 第三节） |
| replay safe/unsafe 在中断后的差异 | 判定映射有 durable.test 锁定 + pi-durable 自身语义保证；Harness 进程级演练待模型 |
| 脚本路径不回归 | v4 e2e（scripts/e2e/run.ts）继续作为回归门槛，ExecutorLoop 未改行为 ✓ |

---

**VERDICT: PASS（partial：Harness 会话实跑待模型）**

（生产者自检结论：三明治嵌入位置与 v5 架构判断一致；replay 映射与 v4 判定
同源；脚本路径回归保护就绪；Harness 实跑如实标注待模型可用。）
