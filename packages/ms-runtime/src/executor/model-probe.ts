/**
 * 模型连接探针（方案 v2.5 步骤 E 验收）：不发 Harness、不碰工具——
 * 只验证模型连接本身是通的。运行：npx tsx executor/model-probe.ts
 */
import { resolveModelProvider } from "./model-config.js";

async function main(): Promise<void> {
  const resolved = resolveModelProvider();
  console.log(`[model-probe] provider=${resolved.provider} modelId=${resolved.modelId ?? "(provider 缺省)"}`);
  const prompt = "What is 2+2? Answer with the number only";
  try {
    const models = resolved.models as unknown as {
      streamSimple?: (
        model: { provider: string; id: string },
        context: { messages: readonly { role: string; content: string }[] },
      ) => Promise<{ content?: string; text?: string }>;
    };
    if (typeof models.streamSimple !== "function") {
      throw new Error("Models 实例无 streamSimple——检查 pi-ai 版本导出面");
    }
    const modelId = resolved.modelId
      ?? (resolved.provider === "openai" ? "gpt-4o-mini" : "unknown");
    const result = await models.streamSimple(
      { provider: resolved.provider, id: modelId },
      { messages: [{ role: "user", content: prompt }] },
    );
    const text = result?.content ?? result?.text ?? JSON.stringify(result).slice(0, 200);
    console.log(`[model-probe] 模型回答: ${String(text).slice(0, 120)}`);
    const ok = String(text).includes("4");
    console.log(`[model-probe] ${ok ? "PASS" : "FAIL"}——回答${ok ? "包含" : "不包含"}预期数字`);
    process.exit(ok ? 0 : 1);
  } catch (error) {
    console.error("[model-probe] FAIL:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

void main();
