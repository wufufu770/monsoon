/**
 * Loom HTTP 客户端（方案 v2.5 步骤三/四的 ms 侧）：跨机契约的动作子集。
 * 零依赖（全局 fetch）；令牌与租户从构造注入；不缓存、失败显式抛错
 * （重试策略在调用方——连接治理七条的 ms 侧纪律）。
 */
export interface LoomClientOptions {
  readonly baseUrl: string;
  /** 双具名主体（方案 5.3）：operator 提交目标/计划，worker 领取/提交。 */
  readonly operatorToken?: string;
  readonly workerToken: string;
  readonly tenantId: string;
  readonly timeoutMs?: number;
  /** 契约握手（拍板十四）：不匹配即拒绝连接并说明。缺省不校验版本内容。 */
  readonly expectedContractVersion?: string;
}

export interface LoomClaim {
  readonly task_id: string;
  readonly worker_id: string;
  readonly epoch: number;
}

export class LoomApiError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`Loom API ${status}: ${body.slice(0, 200)}`);
  }
}

export class LoomClient {
  private readonly timeoutMs: number;

  constructor(private readonly options: LoomClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private async request(method: string, path: string, body?: unknown, idempotencyKey?: string,
                        which: "operator" | "worker" = "worker"): Promise<unknown> {
    const token = which === "operator"
      ? (this.options.operatorToken ?? this.options.workerToken)
      : this.options.workerToken;
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    if (response.status >= 400) throw new LoomApiError(response.status, text);
    return text === "" ? null : JSON.parse(text);
  }

  /** 创建中心 run + 任务并领取（组合形态：执行器以 named worker 身份领取）。 */
  async ensureClaimedTask(input: {
    runIdempotencyKey: string;
    taskId: string;
    workerId: string;
    leaseSeconds?: number;
  }): Promise<{ runId: string; claim: LoomClaim }> {
    const run = (await this.request("POST", "/v1/runs",
      { acceptance: ["tests.pass"] }, input.runIdempotencyKey)) as { run_id: string };
    await this.request("POST", `/v1/runs/${run.run_id}/tasks`,
      { task_id: input.taskId, title: `ms:${input.taskId}` }, `${input.taskId}:create`);
    const claimResult = (await this.request("POST", `/v1/runs/${run.run_id}/claim`,
      { worker_id: input.workerId, lease_seconds: input.leaseSeconds ?? 600 },
      `${input.taskId}:claim`)) as { claim: LoomClaim | null };
    if (claimResult.claim === null) throw new Error(`Loom 无可领取任务: ${run.run_id}`);
    return { runId: run.run_id, claim: claimResult.claim };
  }

  /** 契约版本握手（拍板十四）：中心 /health 带 contract_version；期望值不匹配即抛错。 */
  async handshake(): Promise<{ version: string; contractVersion: string | null }> {
    const health = (await this.request("GET", "/health")) as {
      version?: string; contract_version?: string;
    };
    const contractVersion = health?.contract_version ?? null;
    const expected = this.options.expectedContractVersion;
    if (expected !== undefined && contractVersion !== expected) {
      throw new LoomApiError(426,
        `契约版本不匹配：期望 ${expected}，中心为 ${contractVersion ?? "未声明"}`);
    }
    return { version: health?.version ?? "unknown", contractVersion };
  }

  /** 副作用登记（步骤三端点）：首次 201、重复 200——调用方无需区分。 */
  async registerEffect(runId: string, body: {
    task_id: string;
    worker_id: string;
    epoch: number;
    call_id: string;
    tool_name: string;
    side_effect_level: "read" | "write" | "destructive" | "irreversible";
  }, idempotencyKey: string): Promise<{ call_id: string; status: string }> {
    return (await this.request("POST", `/v1/runs/${runId}/effects`, body, idempotencyKey)) as {
      call_id: string; status: string;
    };
  }

  /** 事件游标分页（步骤三端点）：恢复对账的临时通道（tool.intent/tool.reconciled 投影）。 */
  async eventsPage(runId: string, afterSeq = 0, limit = 100): Promise<{
    events: readonly { seq: number; type?: string; payload?: Record<string, unknown> }[];
    next_seq: number;
  }> {
    return (await this.request("GET",
      `/v1/runs/${runId}/events?after_seq=${afterSeq}&limit=${limit}`)) as never;
  }

  /** 全量事件（对账投影用一次性拉齐，fixture 规模内可接受）。 */
  async eventsAll(runId: string): Promise<
    readonly { seq: number; type?: string; payload?: Record<string, unknown> }[]
  > {
    const result = (await this.request("GET", `/v1/runs/${runId}/events`)) as {
      events: { seq: number; type?: string; payload?: Record<string, unknown> }[];
    };
    return result.events;
  }

  /** 提交产出（epoch 栅栏 + 幂等键）。 */
  async submitOutput(runId: string, taskId: string, epoch: number, workerId: string,
                     output: Record<string, unknown>, idempotencyKey: string): Promise<unknown> {
    return this.request("POST", `/v1/runs/${runId}/tasks/${taskId}/submit`,
      { worker_id: workerId, epoch, output }, idempotencyKey);
  }
}
