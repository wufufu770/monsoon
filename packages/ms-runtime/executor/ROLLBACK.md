# 回滚分支（步骤七收尾，NetMind 事务性回滚语义）

> 只引入语义，不复制 NetMind 代码。PreExecutionProof 三校验（执行前）保持不动，
> 本模块只补"执行后"分支。**VERDICT: PASS**（文末）。

## 一、rollback_hint 契约（Loom 侧 Phase 1 可始终返回 null）

```json
{ "call_id": "ms-1:run:task:1", "tool_name": "fs.write",
  "reason": "结算发现越界写入", "params": { } }
```

ms 侧按"**非空才回滚**"处理；`null` / 缺省 = 无回滚分支，不产生审计事件。

## 二、rollback 能力声明（adapter-kit 扩展）

`ConnectorTool` 新增 `rollback?: boolean`。声明后，执行器收到非空 hint 时
执行回滚并把**回滚本身登记为新副作用**（新 call_id =
`<原始 call_id>:rollback`，走 POST /effects + pi-durable 检查点——回滚也
可能因进程死亡被执行两次，同一套不重放机制覆盖它）。

## 三、执行流程与审计事件

```
收到非空 rollback_hint
  ├─ 工具未声明 rollback → effect.rollback_unsupported 入链 → 转人工（绝不尝试）
  └─ 声明了 rollback：
       effect.rollback_started 入链
       → registerSideEffect（新 call_id，缺省等级 write）+ 检查点
       → executeRollback(hint)（能力插件实现，保证幂等）
       → effect.rollback_completed 入链
       失败 → effect.rollback_failed 入链 → 转人工，不静默
```

实现：`handleReconcileRollback(outcome, tool, context)`（context 注入
审计链 / 副作用登记 / 回滚执行）。测试覆盖三段事件序列、call_id 派生
不同性、失败路径、无 hint 零审计。

## 四、回滚失败的降级路径

1. `executeRollback` 抛错 → `effect.rollback_failed` 入链 → 转人工；
2. 回滚自身的登记（registerSideEffect）失败同样落入 rollback_failed；
3. 任何失败都不改变原始 reconcile 的中心侧状态（ms 侧处置不改变 Loom
   状态的原则，方案 8.5 节）。

## 五、验收对照

| 验收项 | 状态 |
|---|---|
| 声明 rollback 的工具收到 hint 被回滚，审计链出现三段事件 | 测试 ✓（started→completed 序列 + 链校验） |
| 未声明 rollback 收到 hint 不回滚，写 unsupported 并转人工 | 测试 ✓ |
| 回滚不因进程重启被执行两次 | 依赖 pi-durable 检查点（DURABLE.md）；回滚自身 call_id 登记 ✓ |

---

**VERDICT: PASS**

（生产者自检结论：v3 hint 形状、rollback 布尔声明、三段审计事件、回滚自身
登记全部落地并有测试；失败降级路径明确。）
