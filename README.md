# monsoon（monsoon-harness / ms）

> 跑在用户自己机器上的常驻 agent。**单独用**：全天候 agent（CLI harness + 本机 Web 控制台，本地对话、本地执行、本地定时）；**连上 [Loom](https://github.com/Lizekai-522/Loom)**：把需要中心能力（编排、审计、跨机协同）的任务外包给中心；**多机**：多台 ms 各自向同一台 Loom 提交任务，互不踩踏。

⏳ **本仓库当前为占位状态**：方案已定稿、实施尚未开始，完整代码将按批次逐步推送。

## 方案

完整施工方案见 [Loom 仓库 docs/monsoon-harness/](https://github.com/Lizekai-522/Loom/tree/main/docs/monsoon-harness)（方案书 v2.2 / 交接文档 / 调查报告 / 对照调研）。要点：

- **拓扑是反的**：agent 运行时在用户机器上，浏览器与 CLI 只是它的壳；中心（Loom）只做编排与审计
- **五种运行形态**：独立 / 组合 / 分布式 / Loom 自立 / 降级独立——由两个正交装配开关（`MS_ROLE` × `MS_EXECUTION_DOMAIN`）组合
- **16 动作跨机契约**：ms 与 Loom 的唯一交互面；领取带租约、提交带 epoch 栅栏与幂等键、暂停是服务端硬闸门
- **双具名主体**：`<实例>:operator`（提交目标/计划、组装批准）与 `<实例>:worker`（领取任务、提交产出）分离；批准只由人发起
- **幂等键四段式**：`<机器标识>:<run_id>:<task_id>:<尝试序号>`，跨机不碰撞
- **不做自动批准 / 不做自动路由 / 不做出网回调**：回传以轮询为主

## 技术路线（2026-11-01 拍板）

- **Python 吸收重写**（FastAPI / Pydantic / SQLite，与 Loom 同栈）：吸收 rakazo 的租户模型、adapter-kit 契约形状、连接治理七条、宿主沙箱语义、审批规则——不整仓 fork
- **客户端形态**：dsh / Codex 式 CLI harness + 本机常驻服务 + 本机 Web 控制台（仅回环、中文界面）
- **能力插件**：进程内 Python 契约 + 进程外 MCP；RV（Realtime-Venus）执行器同栈直连作为 Phase 1 agent 运行时
- **安全边界（三条命题分别陈述）**：宿主中介约束只防逃逸（文件根限主目录 + 命令放行检查）；插件进程本身不受约束（装插件 = 装软件）；只读标记不覆盖网络出向（以联网声明披露）

## 路线图（六批次，约 61–96 人日）

| 批次 | 内容 | 状态 |
|---|---|---|
| 零 | 钉住来源（rakazo `d13ef7a` / RV `e53ae8d` 快照、锁文件、fork 骨架） | 🔶 大半完成（SHA 已钉、锚点已核对） |
| 一 | 客户端骨架与身份登记（CLI harness + 双主体 + 设备注册） | ⬜ 未开始 |
| 二 | 本机运行时（调度器 / 执行器 / 插件宿主 / 本机派活入口） | ⬜ 未开始 |
| 三 | Loom 侧改造（事件游标分页、副作用登记端点、关闭机器批准路径、角色调整）——与批次一并行 | ✅ 已批准先行 |
| 四 | 跨机契约与分布式（16 动作全通、并发语义验证） | ⬜ 未开始 |
| 五 | 能力插件层与 Loom 自立（MCP 插件、RV 接入、运行预设） | ⬜ 未开始 |

## 相关仓库

- **[Lizekai-522/Loom](https://github.com/Lizekai-522/Loom)** — 编排中心：目标/计划/任务/租约/epoch/事件哈希链/幂等回执/预算
- 参考与致谢：[rakazo](https://github.com/elie222/rakazo)（Apache-2.0，租户与契约概念来源）、[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（dsh，CLI harness 形态参照）、[dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)（MIT，Mandate 凭证等机制参照）、[Realtime-Venus](https://github.com/inclusionAI/Realtime-Venus)（能力来源）
