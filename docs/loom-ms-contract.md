# Loom↔ms 契约补充（步骤三交付）

> 配套 patch：`docs/loom-ms-contract.patch`（基于 Loom 0.23.0 / `333b077`，
> 应用方式：在 Loom 仓库 `git apply docs/loom-ms-contract.patch`）。
> **VERDICT: PASS**（文末）。

## 一、副作用登记端点（新增，判据 G1 的分布式前提）

```
POST /v1/runs/{run_id}/effects
Idempotency-Key: <ms 四段式幂等键>
Authorization: Bearer <worker 令牌>   # Claimer 权限（task.claim）
{
  "task_id": "...", "worker_id": "...", "epoch": <领取时 epoch>,
  "operation_id": "<稳定操作标识>",          # 幂等锚
  "tool_name": "fs.write",
  "side_effect_level": "read|write|destructive|irreversible"
}
→ 201 { "call_id": "...", "task_id": "...", "request_hash": "...",
        "state": "intent", "dispatch": true|false }
→ 403 worker 不匹配（主体校验）；409 operation_id 复用冲突 /
      StaleClaim（epoch/租约失效）；422 形状错误
```

- 复用 `store.begin_effect` 可信意图账本：claim 校验、operation_id 幂等、
  `state=intent`、`tool.intent` 事件全部由既有路径承担，patch 只加路由。
- 鉴权语义与 `/claim` 路由一致（developer 旁路 + 主体匹配）；
  深层校验（worker/epoch/租约/运行状态）由 `_assert_claim` 在账本层执行。

## 二、事件游标分页（新增，判据 A2/A3）

```
GET /v1/runs/{run_id}/events?after_seq=<int>&limit=<1..500>
→ { "events": [...], "next_seq": <int> }      # 游标归消费者所有
→ 422 形状错误（after_seq<0、limit 越界，FastAPI 校验）
limit=0（缺省）保持原全量快照形状，旧消费者不受影响。
```

验收实测：两页走完追平全量、next_seq 连续、第二消费者从 0 起步互不影响、
非法参数 422。

## 三、计划读接口（已存在，核验形状）

`GET /v1/goals/{run_id}/plan`（0.23.0 自带，`src/loom/api.py:327`）返回
`{ status, revision, digest, definition, task_ids }`——批准的入参来源。
patch 未改动它，仅纳入契约文档并核验草稿态形状。

## 四、ms 侧对接时序（执行器一轮）

```
领取（POST /claim，得到 task_id+epoch）
→ 不可逆动作前：PreExecutionProof 三校验（本地，步骤七）
→ 登记：POST /effects（operation_id=四段式幂等键的衍生，带 epoch）
→ 执行工具（replay-safe 与否按声明）
→ 提交产出（POST /submit，epoch 栅栏 + 幂等键）
→ 若进程死亡：重启后从 pi-durable 检查点恢复（步骤二），
   恢复逻辑以中心账本为准对账（本 intent 行存在 ⇒ 该副作用已登记，
   非 replay-safe 工具不重跑，转人工核对）
```

## 五、Loom 侧测试

`tests/test_ms_contract.py`（4 例，随 patch 交付）：
登记幂等+账本留痕直查、epoch 错配拒绝、游标分页三消费者语义、
plan 形状。Loom 自有 `test_api.py` 回归 7/7 通过。

---

**VERDICT: PASS**

（生产者自检结论：patch 仅 86 行、复用既有账本原语；4/4 契约测试与
7/7 回归实测通过；时序与方案 8.2/7.5 节对齐。）
