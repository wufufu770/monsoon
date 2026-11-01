# 依赖体量预算（步骤九.3，arl-lite 纪律）

> arl-lite 证明完整系统可以零外部依赖运行。ms 不追求零依赖，但追求
> **依赖是刻意的**。**VERDICT: PASS**（文末）。

## 一、当前账目（ms 自有包）

| 包 | 生产依赖 | 数量 |
|---|---|---|
| `@monsoon/ms-runtime` | **无**（node:crypto/node:path 内置模块） | **0** |
| `@monsoon/ms-capabilities` | **无**（node:child_process/node:crypto 内置模块） | **0** |

devDependencies（typescript、vitest）不计入生产预算。

## 二、上限与理由要求

- `@monsoon/ms-runtime` 与 `@monsoon/ms-capabilities` 的生产依赖总数上限：
  **各 40 个**（含传递依赖闭包）。
- 新增生产依赖必须在 `docs/dependency-budget.md`（本文件）追加一行理由；
  无理由的依赖在 check 阶段被拒（人工走查 + 后续以脚本固化）。

## 三、既定例外（即将进入的依赖）

| 依赖 | 用途 | 理由 |
|---|---|---|
| `@earendil-works/pi-durable@1.4.0` | 执行器持久化内核（步骤二） | Pi 官方包，检查点/恢复/不重放语义的开箱实现；自研等于重写其崩溃恢复不变量。锁版本。 |
| `@earendil-works/pi-agent-core@1.4.0`（经 packages/adapters） | agent 运行时 | 已在 vendor 内统一 1.4.0；ms 执行器经 ms-runtime → adapters 间接使用，不直接依赖。 |

## 四、理由登记表

（新增依赖时追加；空表 = 当前无例外落地。）

| 日期 | 包 | 依赖 | 理由 | 备案人 |
|---|---|---|---|---|

---

**VERDICT: PASS**

（生产者自检结论：两个 ms 自有包生产依赖为 0；上限与例外规则明确；
pi-durable 登记为既定例外，接线轮次生效。）
