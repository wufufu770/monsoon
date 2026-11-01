/**
 * 托盘 supervisor 核心（方案 v2.5 步骤一）：调度器与执行器子进程的
 * 启动/监控/指数退避重启。进程拓扑（docs/tray-supervisor.md）：
 *
 *   托盘（Electron main）→ supervisor → 调度器子进程（scheduler.db）
 *                                     → 执行器子进程（executor.db + pi-durable 检查点）
 *
 * 本模块只含可测试的监督逻辑（退避策略、稳定运行判据、停止语义）；
 * Electron Tray 与进程 spawn 的接线在 apps/desktop（步骤一的桌面侧）。
 */

export interface ChildSpec {
  /** 子进程名：scheduler / executor。 */
  readonly name: "scheduler" | "executor";
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface SupervisorOptions {
  /** 首次重启延迟毫秒，默认 1000。 */
  readonly restartBaseMs?: number;
  /** 重启延迟上限毫秒，默认 30_000。 */
  readonly restartMaxMs?: number;
  /** 连续稳定运行超过该时长后，退避计数清零，默认 30_000。 */
  readonly stableUptimeMs?: number;
  /** 时钟与定时注入（测试用）。 */
  readonly now?: () => number;
  readonly scheduleTimer?: (fn: () => void, delayMs: number) => () => void;
}

export type SupervisorState =
  | { readonly name: string; readonly state: "starting" | "running" | "backoff" | "stopped"; readonly attempts: number };

/** 指数退避决策（纯函数，测试锁定）：稳定运行清零，否则 base*2^attempts 封顶。 */
export function backoffDelayMs(attempts: number, options: { baseMs: number; maxMs: number }): number {
  return Math.min(options.baseMs * 2 ** attempts, options.maxMs);
}

export class ChildSupervisor {
  private readonly children = new Map<string, {
    spec: ChildSpec;
    attempts: number;
    startedAt: number;
    state: "starting" | "running" | "backoff" | "stopped";
    stopRequested: boolean;
  }>();
  private readonly options: {
    readonly restartBaseMs: number;
    readonly restartMaxMs: number;
    readonly stableUptimeMs: number;
    readonly now: () => number;
    readonly scheduleTimer: (fn: () => void, delayMs: number) => () => void;
  };

  constructor(options: SupervisorOptions = {}) {
    this.options = {
      restartBaseMs: options.restartBaseMs ?? 1_000,
      restartMaxMs: options.restartMaxMs ?? 30_000,
      stableUptimeMs: options.stableUptimeMs ?? 30_000,
      now: options.now ?? Date.now,
      scheduleTimer: options.scheduleTimer ?? ((fn, delayMs) => {
        const timer = setTimeout(fn, delayMs);
        return () => clearTimeout(timer);
      }),
    };
  }

  register(spec: ChildSpec): void {
    this.children.set(spec.name, {
      spec, attempts: 0, startedAt: this.options.now(),
      state: "starting", stopRequested: false,
    });
  }

  /** 子进程退出回调：请求停止则进入 stopped；否则按退避安排重启。返回重启延迟（测试断言用）。 */
  onChildExit(name: string): { restart: boolean; delayMs: number } {
    const child = this.children.get(name);
    if (!child) return { restart: false, delayMs: 0 };
    if (child.stopRequested) {
      child.state = "stopped";
      return { restart: false, delayMs: 0 };
    }
    const uptime = this.options.now() - child.startedAt;
    if (uptime >= this.options.stableUptimeMs) child.attempts = 0;
    const delayMs = backoffDelayMs(child.attempts, {
      baseMs: this.options.restartBaseMs, maxMs: this.options.restartMaxMs,
    });
    child.attempts += 1;
    child.state = "backoff";
    return { restart: true, delayMs };
  }

  /** 记录子进程成功拉起（重启成功后由接线层调用，刷新稳定运行起点）。 */
  markRunning(name: string): void {
    const child = this.children.get(name);
    if (child) {
      child.state = "running";
      child.startedAt = this.options.now();
    }
  }

  /** 托盘显式停止：标记后下次退出不再重启。 */
  requestStop(name: string): void {
    const child = this.children.get(name);
    if (child) child.stopRequested = true;
  }

  status(): readonly SupervisorState[] {
    return [...this.children.entries()].map(([name, child]) => ({
      name, state: child.state, attempts: child.attempts,
    }));
  }
}
