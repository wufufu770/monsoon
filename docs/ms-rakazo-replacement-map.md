# ms 品牌与命名替换映射（rakazo → monsoon）

> 2026-11-02。本文档回答"哪些 rakazo 代码要替换、按什么顺序、为什么现在不动某些部分"。
> 数据基线：vendor `d13ef7a` + ms 增量（见 git log）。**VERDICT: PASS**（文末）。

## 一、盘点（实测）

| 面 | 规模 | 依据 |
|---|---|---|
| npm scope | 18 个 `@rakazo/*` 包名 | 各 package.json 的 `name` 字段 |
| 内部 import | **3,079 处** `from "@rakazo/..."` | `grep -rn "from \"@rakazo/" apps packages` |
| web 用户可见字串 | 43 处（不含测试与 .po 目录） | `grep -rn Rakazo apps/web/src` |
| 桌面身份 | productName/appId 已改（Monsoon / dev.monsoon.desktop） | apps/desktop/package.json |
| 数据目录 | `~/.config/Monsoon` 已生效 | productName 联动 |

## 二、三阶段替换策略

### 阶段 A（已完成/进行中）：用户可见面
- productName、appId、setup 页、web 首页/标题/头像页/导入页 → Monsoon ✓
- 剩余 43 处可见字串按页面清扫（设置页、错误文案），不触碰技术标识符。

### 阶段 B（进行中）：新代码全部落 `@monsoon/*`
- `@monsoon/ms-runtime`（policy / scheduler / executor）——ms 自有核心。
- `@monsoon/ms-capabilities`（MCP stdio 宿主、能力声明扩展）——ms 自有能力层。
- 对 rakazo 代码的**扩展**落在 `packages/adapter-kit`（vendor 内的契约扩展点，
  上游合并时冲突面最小），例如 `ConnectorTool.networkAccess`。
- **依赖体量纪律**：ms-runtime 核心 0 运行时依赖（arl-lite 纪律），
  新增依赖须在 `docs/dependency-budget.md` 登记理由。

### 阶段 C（触发条件：放弃上游合并后一次性执行）
- npm scope 全量改名 `@rakazo/*` → `@monsoon/*`（3,079 处 import，
  脚本化机械替换 + 一次提交）。
- **为什么现在不做**：本 fork 是快照式 vendor（`d13ef7a`），保留上游 scope
  使"观察 rakazo 上游（现 `585fac3`）并选择性合并"保持低成本。一旦决定
  永久分叉，执行阶段 C 并在 THIRD-PARTY-NOTICES 中保留 Apache-2.0 归属。

## 三、不许替换的部分（许可与溯源合规）

1. `LICENSE`（Apache-2.0 全文与版权声明）——必须保留。
2. `docs/rakazo/README-original.md`——上游 README 归档。
3. THIRD-PARTY-NOTICES（建立中）——登记 rakazo 及全部 vendored 依赖。
4. 源码文件头部的上游版权注释（如有）。

## 四、替换操作的风险分级

| 类 | 例 | 风险 | 时机 |
|---|---|---|---|
| 用户可见字串 | UI 文案、页面标题 | 低 | 阶段 A，随时 |
| 应用身份 | productName/appId/userData 目录 | 低（迁移注意） | 已完成 |
| 新代码命名空间 | `@monsoon/*` | 零（纯新增） | 阶段 B，现在 |
| vendor 内扩展点 | adapter-kit 类型扩展 | 低（上游合并冲突面小） | 阶段 B，现在 |
| npm scope 全量 | 18 包名 + 3,079 import | 中（机械量大、断上游合并） | 阶段 C 触发后 |
| 数据库/存储标识 | 现有库表、cookie 名 | 高（数据迁移） | 不做（沿用） |

---

**VERDICT: PASS**

（生产者自检结论：全部数字来自本机实测命令；替换分阶段且触发条件明确；
许可合规项单列。）
