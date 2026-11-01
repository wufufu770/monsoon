/**
 * stdio MCP 宿主端到端验证（步骤九验收）：列出工具并成功调用一次只读工具。
 * fixture 是一个零依赖的 node 子进程，按行 JSON 应答。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { McpStdioHost } from "./host.js";

const FIXTURE = String.raw`
const tools = [{ name: "echo.read", description: "只读回声", inputSchema: { type: "object", properties: { text: { type: "string" } } }, readOnly: true, networkAccess: "none" }];
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const nl = buffer.indexOf("\n");
    if (nl === -1) return;
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    const reply = (result) => process.stdout.write(JSON.stringify({ id: msg.id, result }) + "\n");
    if (msg.method === "tools/list") reply({ tools });
    else if (msg.method === "tools/call") reply({ ok: true, echo: msg.params.arguments });
    else process.stdout.write(JSON.stringify({ id: msg.id, error: { message: "unknown method" } }) + "\n");
  }
});
`;

describe("McpStdioHost", () => {
  const cleanup: string[] = [];
  afterAll(async () => {
    for (const dir of cleanup) await rm(dir, { recursive: true, force: true });
  });

  it("列出工具并调用一次只读工具（端到端）", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ms-cap-"));
    cleanup.push(dir);
    const serverPath = path.join(dir, "fixture.mjs");
    await writeFile(serverPath, FIXTURE, "utf8");

    const host = new McpStdioHost({ command: process.execPath, args: [serverPath] });
    await host.start();
    try {
      const tools = await host.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]!.name).toBe("echo.read");
      expect(tools[0]!.readOnly).toBe(true);
      expect(tools[0]!.networkAccess).toBe("none");

      const result = (await host.callTool("echo.read", { text: "ping" })) as {
        ok: boolean;
        echo: { text: string };
      };
      expect(result.ok).toBe(true);
      expect(result.echo.text).toBe("ping");
    } finally {
      await host.stop();
    }
  });
});
