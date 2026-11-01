# ms 能力声明模板（步骤六，MiniMax Skills 形态参考）

> 参考 MiniMax-AI/skills（MIT）中 `frontend-dev` 与 `vision-analysis` 两个
> SKILL.md 的声明结构，映射到 adapter-kit `ConnectorTool`。**只借用声明形态，
> 不引入运行时依赖、不复制 skill 代码。** **VERDICT: PASS**（文末）。

## 一、MiniMax SKILL.md 的声明结构（提炼）

| 结构 | MiniMax 写法 | 对 ms 的映射 |
|---|---|---|
| name | 稳定标识（`frontend-dev`） | `ConnectorTool.name` |
| description | 三段式：**能力一句话 → "Use when:" 触发词穷举 → 边界（不做什么）** | `ConnectorTool.description`（触发词穷举是路由与披露的依据） |
| metadata | version / category / sources（来源与致谢） | `AdapterDescriptor.adapterVersion` + THIRD-PARTY-NOTICES |
| Invocation | 调用形态（自然语言参数） | `inputSchema`（JSON Schema，缺省兜底见 adapter-kit） |
| Prerequisites | 需要的密钥/外部工具 | 安装确认界面披露（判据 G9）+ 凭证不进 env 的纪律 |
| 边界说明 | "do not read files / do not export" 等显式不做 | `readOnly` / `networkAccess` / `rollback` 三个声明字段 |

**要点**：MiniMax 的质量不在 skill 数量，而在"触发词穷举 + 边界显式不做"
两件事——ms 的工具声明继承这两条纪律。

## 二、声明式 skill 与可执行插件的区别

- **声明式 skill**（MiniMax 形态）：一份说明书，指导模型怎么做事，没有代码入口。
- **可执行插件**（ms 形态）：`ConnectorProvider` 实现，工具调用有真实代码与副作用。
- ms 只借用前者的**声明形态**（写清楚、触发动词穷举、边界显式）来写后者的
  工具声明；MiniMax 的 17 个 skill 不进入 `ms-capabilities`。

## 三、可编译示例（与 ConnectorTool 完全对齐）

```typescript
import type { ConnectorTool } from "@rakazo/adapter-kit";

export const workspaceFileSearch: ConnectorTool = {
  name: "workspace.file-search",
  description:
    "在用户主目录的工作区文件中按关键词搜索文件名与内容（只读，不出网）。" +
    "Use when: 用户要求查找/定位文件、按名字或内容搜索工作区、" +
    "列出最近修改的文件。边界：不做写入/删除/移动；不读取凭证目录" +
    "（.ssh/.aws/.gnupg/浏览器凭证库等由绊线拒绝）；不访问工作区之外。",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1, description: "关键词" },
      glob: { type: "string", description: "可选的文件名过滤，如 *.md" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  readOnly: true,
  networkAccess: "none",
  rollback: false,
};

export const workspaceFileReplace: ConnectorTool = {
  name: "workspace.file-replace",
  description:
    "在工作区文件内执行精确文本替换（写操作，需审批门）。" +
    "Use when: 用户明确要求修改文件内容并给出原文与新文本。边界：" +
    "不删除文件；不做正则全局替换（逐处显式替换）；命中凭证路径时被绊线拒绝。",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      original: { type: "string", minLength: 1 },
      replacement: { type: "string" },
    },
    required: ["path", "original", "replacement"],
    additionalProperties: false,
  },
  readOnly: false,
  networkAccess: "none",
  rollback: true, // 声明支持 reconcile 的 rollback_hint 回滚（DURABLE 检查点覆盖）
};
```

（类型检查：两例均为合法 `ConnectorTool`，`packages/adapter-kit` 下 tsc 通过。）

## 四、ms 扩展字段的声明纪律

1. **networkAccess**：`none` 只有纯本地工具可声明；任何 fetch/外部 API 调用
   都必须 `declared`；不确定就留缺省——`undeclared` 时界面披露"此能力可能
   联网"，且在 remote 执行域，**写工具的 undeclared 会被 PreExecutionProof 拦截**。
2. **replay-safe 判定**（步骤二）：`readOnly === true` 且
   `networkAccess ∈ {none, declared}` 才可 safe；`undeclared` 一律 unsafe——
   上例 `workspaceFileSearch` 是 safe，`workspaceFileReplace` 是 unsafe。
3. **rollback**：只有具备可幂等回滚实现（并给出回滚副作用等级）的写工具才
   声明 `rollback: true`；未声明的写工具收到 rollback_hint 时转人工，
   不尝试回滚。

---

**VERDICT: PASS**

（生产者自检结论：两个 MiniMax SKILL.md 实际抓取提炼；示例为可编译
ConnectorTool；networkAccess 缺省披露与 replay-safe 判定规则显式写出；
未复制 skill 代码、未引入运行时依赖。）
