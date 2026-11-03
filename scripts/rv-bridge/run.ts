/**
 * RV 接入端到端验证（方案 v2.5 批次五，判据 D3 的 RV 版）：
 * McpStdioHost 拉起 RV 桥接器（真导入 RV harness/skills.py 的 SkillRegistry），
 * 列出 RV 能力（routing_contracts → 工具声明）并成功调用一次只读能力。
 * 运行：npx tsx scripts/rv-bridge/run.ts
 */
import path from "node:path";
import { McpStdioHost } from "@monsoon/ms-capabilities";

async function main(): Promise<void> {
  const bridge = path.resolve(import.meta.dirname ?? ".", "rv_mcp_bridge.py");
  const host = new McpStdioHost({
    command: "python3",
    args: [bridge, path.resolve(import.meta.dirname ?? ".", "../../../rv")],
    handshakeTimeoutMs: 20_000,
  });
  await host.start();
  try {
    const tools = await host.listTools();
    console.log(`[rv-e2e] 工具: ${tools.map((tool) => tool.name).join(", ")}`);
    const wordcount = tools.find((tool) => tool.name === "wordcount");
    if (!wordcount) throw new Error("RV 能力 wordcount 未注册");
    if (wordcount.readOnly !== true || wordcount.networkAccess !== "none") {
      throw new Error("披露声明不符（应 readOnly + 不出网）");
    }
    const result = (await host.callTool("wordcount", { text: "hello monsoon" })) as {
      ok: boolean;
      result: { words: number; chars: number; planner_saw: string };
    };
    console.log(`[rv-e2e] plan 结果: ${JSON.stringify(result)}`);
    const ok = result.ok === true
      && result.result.words === 2
      && result.result.chars === "hello monsoon".length
      && result.result.planner_saw === "rv-bridge-host";
    console.log(`[rv-e2e] ${ok ? "PASS" : "FAIL"}——RV 能力经 MCP stdio 列出并调用成功，planner 由宿主注入`);
    process.exit(ok ? 0 : 1);
  } finally {
    await host.stop();
  }
}

void main().catch((error: unknown) => {
  console.error("[rv-e2e] FAIL:", error);
  process.exit(1);
});
