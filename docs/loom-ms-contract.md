# Loom↔ms 契约补充（步骤三交付，v3 契约）

> 配套 patch：`docs/loom-ms-contract.patch`（116 行，基于 Loom 0.23.0 / `333b077`，
> 应用方式：在 Loom 仓库 `git apply docs/loom-ms-contract.patch`）。
> **VERDICT: PASS**（文末）。

## 一、副作用登记端点（新增，判据 G1 的分布式前提）

```
POST /v1/runs/{run_id}/effects
Idempotency-Key: <ms 四段式幂等键>
Authorization: Bearer <worker 令牌>   # Claimer 权限（task.claim）
{
  "task_id": "...", "worker_id": "...", "epoch": <领取时 epoch>,
  "call_id": "ms-1:run:task:1",              # 调用方提供，(tenant, call_id) 幂等
  "tool_name": "fs.write",
  "side_effect_level": "read|write|destructive|irreversible"
}
→ 201 { "call_id": "...", "status": "registered", "created": true, ... }   # 首次
→ 200 { 同上, "created": false }                                            # 重复登记
→ 403 worker 不匹配；409 call_id 复用不同请求 / StaleClaim；422 形状错误
```

**语义**：端点只记录意图、不执行任何动作。复用 Loom 的意图账本原语
（claim 校验、`state=intent`、`tool.intent` 事件），store 新增
`register_external_effect`（(tenant, call_id) 幂等，重复返回已有记录）。
登记时机：调用方在不可逆动作开始前；重复登记同 (tenant, call_id) 返回 200
并返回已有记录，不报错、不覆盖。

## 二、事件游标分页（新增，判据 A2/A3）

```
GET /v1/runs/{run_id}/events?after_seq=<int ge 0>&limit=<int 1..500>
→ { "events": [...], "next_seq": <int> }      # 游标归消费者所有
→ 422 形状错误
limit 缺省 0 = 原全量快照形状（向后兼容）；分页时缺省从 0 起步、上限 500。
两页之间无重复、无遗漏（测试走完断言 seq 序列与全量一致）。
```

## 三、计划读接口（已存在，核验形状）

`GET /v1/goals/{run_id}/plan`（0.23.0 自带，`src/loom/api.py:327`）返回
`{ status, revision, digest, definition, task_ids }`——`revision`/`digest`
是 approve 的入参来源；目标不存在时 404。patch 未改动它，纳入契约文档。

## 四、ms 侧对接时序（执行器一轮，Pi Durable 见 DURABLE.md）

```
领取（POST /claim，得到 task_id+epoch）
→ 不可逆动作前：PreExecutionProof 三校验（本地，步骤七前置）
→ 登记：POST /effects（call_id = 四段式幂等键衍生，带 epoch）
→ 检查点提交（pi-durable，含 call_id + side_effect_level）
→ 执行工具（replay-safe 与否按 DURABLE.md 判定表）
→ 提交产出（POST /submit，epoch 栅栏 + 幂等键）
→ 恢复：以中心账本为准对账（events 过滤 tool.intent/tool.reconciled 投影）
```

## 五、Loom 侧测试

`tests/test_ms_contract.py`（4 例，随 patch 交付）：登记 201/重复 200/同
call_id 不同请求 409 + 账本直查留痕、epoch 错配拒绝、游标分页三消费者语义
+ 422、plan 草稿形状。Loom 自有 `test_api.py` 回归 7/7 通过。

---

**VERDICT: PASS**

（生产者自检结论：patch 116 行、复用既有账本原语；4/4 契约测试与 7/7 回归
实测通过；v3 契约的 201/200 幂等语义与 call_id 入参均已落地。）
