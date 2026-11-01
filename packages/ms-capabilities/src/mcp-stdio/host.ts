/**
 * 最小 stdio MCP 宿主（方案 v2.5 步骤九，arl-lite 形态参考）。
 *
 * 进程外能力插件的零依赖通道：宿主 spawn 插件进程，按行分隔的 JSON-RPC
 * 通信，只有三类消息——tools/list（列出工具声明）、tools/call（调用）、
 * cancel（取消在途调用，按 executionId）。
 *
 * 这是 ms 自己的最小协议（MCP stdio 形态），不是完整 MCP 规范实现；
 * 完整 MCP 宿主在批次五交付。零运行时依赖（node:child_process + node:crypto）。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

export interface McpToolDeclaration {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  /** 与 adapter-kit ConnectorTool 对齐（步骤五扩展）。 */
  readonly readOnly?: boolean;
  readonly networkAccess?: "none" | "declared" | "undeclared";
}

export interface McpStdioOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  /** 握手超时毫秒，默认 10_000。 */
  readonly handshakeTimeoutMs?: number;
  /** 单次调用超时毫秒，默认 60_000。 */
  readonly callTimeoutMs?: number;
}

export class McpStdioHost {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private nextId = 1;
  private readonly timeouts: {
    handshakeTimeoutMs: number;
    callTimeoutMs: number;
  };

  constructor(private readonly options: McpStdioOptions) {
    this.timeouts = {
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? 10_000,
      callTimeoutMs: options.callTimeoutMs ?? 60_000,
    };
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.child = spawn(this.options.command, this.options.args ?? [], {
        cwd: this.options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child.stdout.setEncoding("utf8");
      this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
      this.child.stderr.setEncoding("utf8");
      this.child.stderr.on("data", () => undefined); // 插件日志丢弃，不进协议通道
      this.child.on("exit", () => this.rejectAll(new Error("capability process exited")));
      this.child.on("error", (error) => this.rejectAll(error));

      const handshakeTimer = setTimeout(() => {
        reject(new Error("capability handshake timeout"));
      }, this.timeouts.handshakeTimeoutMs);
      // 握手即第一次 tools/list：能应答就视作进程就绪。
      void this.request("tools/list", {})
        .then(() => {
          clearTimeout(handshakeTimer);
          resolve();
        })
        .catch((error: unknown) => {
          clearTimeout(handshakeTimer);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  async listTools(): Promise<McpToolDeclaration[]> {
    const result = (await this.request("tools/list", {})) as { tools?: McpToolDeclaration[] };
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request("tools/call", { name, arguments: args });
  }

  /** 取消在途调用：发 cancel 消息并立即拒绝本端等待者（对端自行收尾）。 */
  cancel(executionId: string): void {
    this.child?.stdin.write(`${JSON.stringify({ method: "cancel", params: { executionId } })}\n`);
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.child === null) return resolve();
      this.child.on("exit", () => resolve());
      this.child.kill();
      this.rejectAll(new Error("host stopped"));
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line === "") continue;
      try {
        const message = JSON.parse(line) as {
          id?: string;
          result?: unknown;
          error?: { message?: string };
        };
        if (message.id === undefined) continue;
        const waiter = this.pending.get(message.id);
        if (waiter === undefined) continue;
        this.pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error) {
          waiter.reject(new Error(message.error.message ?? "capability call failed"));
        } else {
          waiter.resolve(message.result);
        }
      } catch {
        // 非法行丢弃；协议通道里混入的日志不致死。
      }
    }
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.child === null) return Promise.reject(new Error("host not started"));
    const id = randomUUID();
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`capability call timeout: ${method}`));
      }, this.timeouts.callTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`${payload}\n`);
    });
  }

  private rejectAll(error: Error): void {
    for (const [, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }
}
