/**
 * 模型接入配置（方案 v2.5 步骤 E）：本地 Ollama 与云端 API 双路径。
 *
 * 优先级：MS_MODEL_PROVIDER 环境变量（ollama/openai/anthropic/openrouter）
 * > OPENAI_API_KEY 存在 → openai > 回退 ollama（读 ~/.pi/agent/models.json
 * 或 MS_PI_MODELS_JSON 指定的配置文件）。不硬编码模型名——Ollama 的模型
 * 列表由配置文件决定。
 */
import { createModels, createProvider, type Models } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { envApiKeyAuth } from "@earendil-works/pi-ai";
import * as openaiCompletions from "@earendil-works/pi-ai/api/openai-completions";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export type ModelProviderKind = "ollama" | "openai" | "anthropic" | "openrouter";

export interface ResolvedModelProvider {
  readonly provider: ModelProviderKind;
  readonly models: Models;
  /** Ollama 配置文件里的第一个模型 id（探针/缺省会话用）。 */
  readonly modelId?: string;
}

interface PiModelsConfig {
  readonly providers?: Record<string, {
    readonly baseUrl?: string;
    readonly api?: string;
    readonly apiKey?: string;
    readonly models?: readonly {
      readonly id: string;
      readonly contextWindow?: number;
      readonly maxTokens?: number;
      readonly reasoning?: boolean;
    }[];
  }>;
}

/** 读取 Pi 的 models.json（~/.pi/agent/models.json 或 MS_PI_MODELS_JSON）。 */
export function readPiModelsConfig(env: NodeJS.ProcessEnv = process.env): PiModelsConfig {
  const configPath = env.MS_PI_MODELS_JSON
    ?? path.join(os.homedir(), ".pi", "agent", "models.json");
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as PiModelsConfig;
  } catch {
    return {};
  }
}

/** 按 v2.5 步骤 E 的优先级解析模型提供方并产出 Models 实例。 */
export function resolveModelProvider(env: NodeJS.ProcessEnv = process.env): ResolvedModelProvider {
  const kind: ModelProviderKind = (env.MS_MODEL_PROVIDER as ModelProviderKind | undefined)
    ?? (env.OPENAI_API_KEY ? "openai" : "ollama");
  const models = createModels();

  if (kind === "openai") {
    models.setProvider(openaiProvider()); // 自读 OPENAI_API_KEY
    return { provider: "openai", models };
  }
  if (kind === "anthropic") {
    models.setProvider(anthropicProvider()); // 自读 ANTHROPIC_API_KEY
    return { provider: "anthropic", models };
  }
  if (kind === "openrouter") {
    models.setProvider(createProvider({
      id: "openrouter",
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      auth: { apiKey: envApiKeyAuth("OpenRouter API key", ["OPENROUTER_API_KEY"]) },
      models: [],
      api: { "openai-completions": openaiCompletions },
    }));
    return { provider: "openrouter", models };
  }
  // ollama：配置来自 Pi 的 models.json（不硬编码模型名）。
  const config = readPiModelsConfig(env);
  const ollama = config.providers?.["ollama"];
  if (ollama === undefined) {
    throw new Error(
      "Ollama 未配置：请创建 ~/.pi/agent/models.json（providers.ollama），"
      + "或设置 MS_MODEL_PROVIDER=openai 并提供 OPENAI_API_KEY",
    );
  }
  const modelId = ollama.models?.[0]?.id;
  models.setProvider(createProvider({
    id: "ollama",
    name: "Ollama（本机）",
    baseUrl: ollama.baseUrl ?? "http://127.0.0.1:11434/v1",
    auth: { apiKey: envApiKeyAuth("Ollama API key", ["OLLAMA_API_KEY"]) },
    models: (ollama.models ?? []).map((model) => ({
      id: model.id,
      name: model.id,
      api: "openai-completions" as const,
      provider: "ollama",
      baseUrl: ollama.baseUrl ?? "http://127.0.0.1:11434/v1",
      input: ["text"] as ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      reasoning: model.reasoning ?? false,
      contextWindow: model.contextWindow ?? 32_768,
      maxTokens: model.maxTokens ?? 8_192,
    })),
    api: { "openai-completions": openaiCompletions },
  }));
  return { provider: "ollama", models, modelId };
}
