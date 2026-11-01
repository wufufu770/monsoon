# Monsoon

**Monsoon（monsoon-harness / ms）是跑在用户自己电脑上的桌面 AI agent。**
它可以独立工作，也可以把需要编排与审计的任务交给 [Loom](https://github.com/Lizekai-522/Loom) 中心处理。

- **独立使用**：安装即用——托盘常驻、本地对话、本机执行、本地定时，无账号、无云端依赖，接入大模型 API key 即可。
- **连接 Loom**：把需要编排、审计、预算控制的任务外包给 Loom 中心；一台 ms 可同时服务多台 Loom，多台 ms 可共用一台 Loom 而互不踩踏。

> 状态：**v5 开发中**。核心链路（派活 → 执行 → 副作用登记 → 崩溃恢复不重放）已通过全链路联调；
> 模型会话接入正在集成。方案与施工记录见 [`docs/`](docs/)。

## 它解决什么问题

市面上的桌面 agent 通常面临三个矛盾：能力上限与数据安全、自动化与可控性、
单机智能与多机协同。Monsoon 的回答是把**执行放在你的机器上**（数据不出本机），
把**编排与审计放在 Loom 中心**（可验证、可追责），两者之间用一份显式契约连接：

- **执行前有证明**：不可逆动作开始前经过三重本地校验（副作用等级是否在批准范围内、
  联网声明是否一致、是否触碰凭证路径绊线），任一不过就不执行。
- **执行中有登记**：每个副作用在开始前向中心登记意图，进程崩溃也不会导致
  已执行的不可逆动作被偷偷重放。
- **恢复后以中心账本为准**：本机检查点与中心账本不一致时，以中心为准——
  已登记未结算的副作用转人工核对，而不是自动重跑。

## 核心特性

- **桌面常驻**：Electron 应用，托盘常驻；调度器与执行器作为受监督的子进程运行，
  崩溃后按指数退避自动重启，关窗不停工。
- **持久执行**：基于 pi-durable 的检查点内核——任务崩溃后从检查点恢复，
  只读工具可安全重跑，写工具绝不重放。
- **双执行域**：本机执行（数据不出机器）与中心执行（Loom 编排）由空间策略显式指定，
  不做黑盒自动路由。
- **能力插件**：进程内 TypeScript 插件 + 进程外 MCP 双通道；工具声明带
  只读标记、联网声明与回滚能力，安装时显式披露。
- **可审计**：本地审计哈希链 + 中心事件链，每个判定动作（拦截/放行/回滚）都有记录。

## 快速开始

```bash
# 依赖：Node.js 22.13+ 与 pnpm 9.15+
git clone https://github.com/wufufu770/monsoon.git
cd monsoon
pnpm install
pnpm --filter @rakazo/web build && pnpm --filter @rakazo/desktop build

# 启动桌面应用（开发模式）
pnpm --filter @rakazo/desktop dev
```

首次启动选择「本机模式」——agent 在你的电脑上运行，无需任何账号。
在设置中接入你的大模型 API key（或配置本地 Ollama）即可开始使用。

打包产物（Linux AppImage 等）：见 [`apps/desktop/BUILD-PIPELINE.md`](apps/desktop/BUILD-PIPELINE.md)。

## 连接 Loom（可选）

1. 部署 [Loom](https://github.com/Lizekai-522/Loom) 中心（含 ms 契约端点补丁，
   见 [`docs/loom-ms-contract.md`](docs/loom-ms-contract.md)）；
2. 在 Monsoon 首屏选择「连接 Loom 中心」，填入中心地址完成设备配对；
3. 此后可以在 Monsoon 里把任务提交给 Loom 编排执行，进度与审计实时同步。

## 文档

| 文档 | 内容 |
|---|---|
| [方案书 v2.5](https://github.com/Lizekai-522/Loom/tree/main/docs/monsoon-harness) | 完整施工方案：决策记录、跨机契约、批次计划、验收判据 |
| [BUILD-PIPELINE.md](apps/desktop/BUILD-PIPELINE.md) | 构建管线与产物结构 |
| [TRAY-SUPERVISOR.md](apps/desktop/TRAY-SUPERVISOR.md) | 托盘进程模型与平台验证状态 |
| [DURABLE.md](packages/ms-runtime/executor/DURABLE.md) | 持久执行内核：检查点、replay-safe 判定、恢复对账 |
| [SECURITY-BOUNDARY.md](packages/ms-runtime/policy/SECURITY-BOUNDARY.md) | 安全边界：代码常量与审计哈希链 |
| [GATEWAY.md](packages/ms-runtime/scheduler/GATEWAY.md) | 事件网关与两级过滤 |
| [MODEL-INTEGRATION.md](docs/MODEL-INTEGRATION.md) | 模型接入：本地 Ollama 与云端 API |

## 项目结构

```
apps/desktop            桌面应用（Electron）：托盘、主窗口、调度器/执行器子进程
apps/api、apps/worker   本机服务栈（过渡期承载 web/api，逐步内嵌）
apps/web                工作台前端
packages/ms-runtime     ms 自有运行时：安全边界、事件网关、执行器循环、监督器
packages/ms-capabilities  能力插件层（MCP stdio 宿主）
packages/adapter-kit    能力契约层（含 ms 扩展：联网声明、回滚声明）
packages/*（其余）       vendor 基座（rakazo，Apache-2.0）：契约、租户、隔离、审计
docs/                   方案书、契约、联调记录、施工文档
```

## 路线图

- [x] 批次零：基线快照与裁剪
- [x] 批次一：桌面壳、本机栈、零账号体验
- [x] 批次二（进行中）：托盘监督、pi-durable 内核、事件网关、安全边界
- [x] 批次三：Loom 契约端点（副作用登记 / 事件游标 / 计划读）
- [x] 首次全链路联调（三场景通过，含 kill -9 不重放）
- [ ] 模型会话接入（本地 Ollama 与云端 API 双路径）
- [ ] 多中心设备直连实时通道
- [ ] 能力插件生态（MCP 一键安装与披露）

## 许可与致谢

本项目基于 [rakazo](https://github.com/elie222/rakazo)（Apache-2.0）重构二开，
继承其 Apache-2.0 许可；agent 运行时参考
[pi-durable](https://github.com/earendil-works/pi-durable)（同系依赖）。
编排中心 [Loom](https://github.com/Lizekai-522/Loom) 为本项目的姊妹项目。
完整第三方声明见 `docs/` 与各依赖仓库。
