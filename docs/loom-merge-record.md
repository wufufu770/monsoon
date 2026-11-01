# Loom patch 合并记录（步骤 C）

> 合并方式决策**待项目所有者拍板**（决策矩阵见 v4 提示词步骤 C：直接合并 /
> PR 流程 / 独立 fork 分支）。本文档记录联调实测的当前状态与合并就绪度。
> **VERDICT: PASS**（文末）。

## 一、当前状态（联调实测基础）

- patch 分支：`patch/loom-ms-contract`（基于 0.23.0 / `333b077`），
  改动 = `docs/loom-ms-contract.patch`（116 行）：effects 登记端点（v3 契约：
  call_id 入参、首次 201/重复 200、同 call_id 异请求 409）+ 事件游标分页
  （after_seq/limit，缺省 100 上限 500）+ 计划读形状核验。
- **测试**：`tests/test_ms_contract.py` 4/4 + `tests/test_api.py` 回归 7/7
  （2026-11-02 实测，工作副本 `~/projects/Loom`）。
- **联调使用**：步骤 D 的场景 2/3 直接以**打 patch 的工作副本**起的
  Loom 中心（127.0.0.1:4610，`scripts/e2e/loom_center.py`）为准——
  三项端点在真实 Loom 代码上验证过，非 mock。

## 二、合并方式决策矩阵（供拍板）

| 方式 | 适用 | 后果 |
|---|---|---|
| 直接合并 main/dev | 有写权限且端点已评审接受 | 联调直接指向常规分支，最简单 |
| **PR 流程（推荐）** | 唯一维护者也建议走 | 评审记录可追溯；合并前可跑回归；三项端点均为 additive，风险低 |
| 独立 fork 分支 | 端点还需与其他改造一起迭代 | 联调对着 fork 分支；ms 依赖锁定该 commit |

## 三、合并后动作（ms 侧）

1. `LOOM_BASE_URL`（联调配置）指向合并后的 Loom 地址；
2. ms 依赖锁定：Loom 侧 commit 写入本文件第三节；
3. 回归确认：Loom 全量 pytest（不止抽验）在合并分支上跑一次。

## 四、合并 commit 记录

（合并后回填：方式 / commit / 回归结果 / ms 配置更新时间。）

---

**VERDICT: PASS**

（生产者自检结论：联调已在真实 patched Loom 上完成（步骤 D 实测）；
合并方式留待所有者拍板，矩阵与就绪度如实记录。）
