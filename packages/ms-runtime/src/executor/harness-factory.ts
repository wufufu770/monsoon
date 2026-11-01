/**
 * Harness 工具注册工厂（方案 v2.5 步骤 F）。
 *
 * 架构约束（v5 提示词的关键判断）：pi-durable 的 Harness 拥有模型循环与工具
 * 执行，v4 的三明治（登记 → 检查点 → 执行）必须在 `defineTool` 的 `execute`
 * **内部**嵌入，而不是在 Harness 外面包一层——否则会出现"Harness 执行了工具
 * 但执行器不知道"的脱节。
 *
 * replay 映射：`toolReplayPolicy`（readOnly 且联网非 undeclared → safe）的结果
 * 直接写进 ToolRegistration 的 `replay` 字段，不另立判定。
 * 执行器不调用 reconcile（结算权限在中心操作员）——该边界在模型会话下不变。
 */
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import { runPreExecutionProof, type ProofExecutionPolicy } from "./pre-execution-proof.js";
import { toolReplayPolicy } from "./durable.js";
import { sideEffectCallId } from "./loop.js";
import type { ExecutorTool } from "./loop.js";
import type { LoomClient } from "../loom/client.js";
import type { AuditChain } from "../policy/audit-chain.js";

export interface SandwichDeps {
  /** 连 Loom（组合/分布式）时提供；缺省 = 独立形态（read 级同样不登记）。 */
  readonly loom?: LoomClient;
  readonly workerId: string;
  readonly homeDir: string;
  readonly audit: AuditChain;
  readonly policy?: ProofExecutionPolicy;
  /** 中心 run/task 上下文（会话级，由会话建立时确定）。 */
  readonly centerRunId?: string;
  readonly centerTaskId?: string;
  readonly centerEpoch?: number;
}

export interface SandwichOutcome {
  readonly ok: boolean;
  readonly callId?: string;
  readonly proofFailures?: readonly string[];
  readonly result?: unknown;
  readonly error?: string;
}

/**
 * 三明治核心（可独立测试，不依赖 Harness Context）：
 * PreExecutionProof 三校验 →（write 及以上且连 Loom）登记 → 执行实际工具。
 * 与 v4 loop.ts 的顺序一致；模型会话只是换了调用方。
 */
export async function executeWithSandwich(
  tool: ExecutorTool,
  args: Record<string, unknown>,
  deps: SandwichDeps,
  taskId: string,
  attempt = 1,
): Promise<SandwichOutcome> {
  const proof = runPreExecutionProof(
    {
      tool: { name: tool.name, readOnly: tool.readOnly, networkAccess: tool.networkAccess },
      sideEffectLevel: tool.sideEffectLevel,
      requestedPath: typeof args["path"] === "string" ? (args["path"] as string) : undefined,
      homeDir: deps.homeDir,
    },
    deps.policy ?? { executionDomain: deps.loom ? "remote" : "local", approvedSideEffectLevels: ["read", "write"] },
  );
  if (!proof.ok) {
    deps.audit.append({
      type: "proof.rejected", actor: "executor",
      payload: { taskId, tool: tool.name, failures: proof.failures },
    });
    return { ok: false, proofFailures: proof.failures.map((f) => f.code) };
  }

  let callId: string | undefined;
  if (deps.loom && tool.sideEffectLevel !== "read" && deps.centerRunId && deps.centerTaskId) {
    callId = sideEffectCallId(deps.workerId, taskId, attempt);
    await deps.loom.registerEffect(deps.centerRunId, {
      task_id: deps.centerTaskId, worker_id: deps.workerId, epoch: deps.centerEpoch ?? 0,
      call_id: callId, tool_name: tool.name, side_effect_level: tool.sideEffectLevel,
    }, `${taskId}:${callId}:effect`);
    deps.audit.append({
      type: "effect.registered", actor: "executor",
      payload: { taskId, callId, centerRunId: deps.centerRunId },
    });
  }

  try {
    const result = await tool.execute(args);
    deps.audit.append({
      type: "tool.executed", actor: "executor",
      payload: { taskId, tool: tool.name, callId },
    });
    return { ok: true, callId, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.audit.append({
      type: "tool.failed", actor: "executor",
      payload: { taskId, tool: tool.name, callId, error: message },
    });
    return { ok: false, callId, error: message };
  }
}

/**
 * 把 ms 工具列表包装成 pi-durable extension。每个工具：
 * - `replay` 由 toolReplayPolicy 决定（safe ⟺ readOnly 且联网非 undeclared）；
 * - `execute` 内部完成三明治（证明 → 登记 → 执行），返回给模型的是结果文本。
 */
export function createExecutorExtension(
  tools: readonly ExecutorTool[],
  deps: SandwichDeps,
  taskId: string,
): Extension {
  const registrations = tools.map((tool) => {
    const replay = toolReplayPolicy(tool);
    return defineTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as never,
      replay,
      async execute(args) {
        const outcome = await executeWithSandwich(tool, args as Record<string, unknown>, deps, taskId);
        if (!outcome.ok) {
          return {
            isError: true,
            output: JSON.stringify({
              error: outcome.error ?? "pre-execution proof rejected",
              proofFailures: outcome.proofFailures,
            }),
          } as never;
        }
        return { output: JSON.stringify(outcome.result ?? null) } as never;
      },
    });
  });
  return defineExtension({ name: "monsoon-executor", tools: registrations });
}
