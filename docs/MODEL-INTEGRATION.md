# 模型接入：本地 Ollama 与云端 API 双路径（步骤 E）

> 代码：`packages/ms-runtime/src/executor/model-config.ts`（解析）+
> `model-probe.ts`（连接探针）。**VERDICT: PASS（partial：探针实跑待模型）**（文末）。

## 一、两条路径

| 路径 | 选择方式 | 模型 id 来源 |
|---|---|---|
| 本地 Ollama | `MS_MODEL_PROVIDER=ollama`（或无 OPENAI_API_KEY 时缺省回退） | `~/.pi/agent/models.json`（或 `MS_PI_MODELS_JSON`）——**不硬编码模型名** |
| 云端 API | `MS_MODEL_PROVIDER=openai/anthropic/openrouter` + 对应 key 环境变量 | provider 内置目录 |

优先级：`MS_MODEL_PROVIDER` > `OPENAI_API_KEY 存在→openai` > `ollama`。
Ollama 未配置且无 key 时 `resolveModelProvider` 抛出可读错误（探针实测验证了
这条错误路径）。

### Ollama 配置文件形状（models.json）

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://127.0.0.1:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "qwen2.5-coder:7b", "contextWindow": 32768, "maxTokens": 8192 }
      ]
    }
  }
}
```

模型目录条目映射到 pi-ai 的完整 `Model` 形状（cost 全零、input=["text"]、
reasoning 可配）。实现按 pi-ai 1.4.0 实测 API：`createProvider` + `auth.apiKey`
（envApiKeyAuth）+ `api: { "openai-completions": <stream 模块> }`。

### 云端 API

```bash
export OPENAI_API_KEY=...        # 或 MS_MODEL_PROVIDER=anthropic + ANTHROPIC_API_KEY
# 或 MS_MODEL_PROVIDER=openrouter + OPENROUTER_API_KEY
```

## 二、连接探针

```bash
cd packages/ms-runtime && npx tsx src/executor/model-probe.ts
```

发"What is 2+2? Answer with the number only"，断言回答含 "4"。
不涉及 Harness 与工具——只验证模型连接。

## 三、实跑状态（如实记录）

- **本机构建环境（Kali/Linux）无 Ollama、无云端 API key**：探针当前输出
  "Ollama 未配置"并按设计失败退出——错误路径已实测 ✓。
- **待模型可用后的实跑清单**：①`ollama pull qwen2.5-coder:7b`（确认支持
  tool calling）；②写 models.json；③跑探针记录模型 id 与回答；
  ④步骤 G 的模型模式 e2e。
- **本地模型工具调用的已知风险**：小模型常输出不合法 tool_calls（整数写成
  字符串、数组序列化为字符串）。缓解手段 **toolrails**（agent 与 Ollama 之间
  的规范化代理，OpenAI API 兼容，只改 baseUrl）——pi-durable 的
  ToolRegistration 亦有 `repairArgs` 钩子（验证前修复常见参数错误，纯函数），
  ms 优先用该内置机制，不够再引入 toolrails。**不强制引入**，失败率实测
  过高时作为回退记录于此。
- 模型切换运行时语义：models.json 每次打开模型选择时重载，无需重启 ms。

---

**VERDICT: PASS（partial：探针实跑待模型可用）**

（生产者自检结论：双路径实现按 pi-ai 1.4.0 实测 API 写就、类型清零；错误
路径（无配置）实测；成功路径与工具调用失败率观察待模型，如实标注。）
