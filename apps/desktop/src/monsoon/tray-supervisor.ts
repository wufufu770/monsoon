/**
 * ms 托盘 supervisor（方案 v2.5 步骤一的桌面侧落地）。
 *
 * 职责边界（tray-supervisor.md）：
 * - 拥有调度器与执行器两个子进程的生命周期：spawn、异常退出按指数退避重启、
 *   before-quit 时 SIGTERM → 5s → SIGKILL 的优雅退出。
 * - 托盘常驻边界：托盘退出即全部子进程退出，不做"关托盘后服务仍在"的超集语义，
 *   不做 manifest adoption。
 * - 不负责恢复逻辑本身：执行器子进程启动时自行从本机 SQLite / pi-durable
 *   恢复（步骤二）；supervisor 不读 pi-durable 的存储。
 *
 * 子进程形态：process.execPath + ELECTRON_RUN_AS_NODE=1 运行编译后的
 * monsoon/scheduler-main.js 与 monsoon/executor-main.js（build.mjs 增加入口）。
 * 存储句柄由子进程各自打开（openLocalStores，共用 ms-data 数据目录）。
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { Tray, Menu, nativeImage, app } from "electron";
import { ChildSupervisor, type ChildSpec } from "@monsoon/ms-runtime/supervisor";

export interface TraySupervisorOptions {
  /** 编译产物目录（dist），子进程入口在其中。 */
  readonly distDir: string;
  /** ms 本机数据目录（子进程各自在其下开 SQLite 句柄）。 */
  readonly dataDir: string;
  /** 托盘图标路径（PNG）。 */
  readonly iconPath?: string;
  /** 打开主窗口的回调（托盘菜单"打开窗口"）。 */
  readonly showMainWindow: () => void;
  /** 最大重启次数，超过后停止并告警，默认 10。 */
  readonly maxRestarts?: number;
}

interface ManagedChild {
  readonly spec: ChildSpec;
  process: ChildProcess | null;
  killTimer: NodeJS.Timeout | null;
}

export class TraySupervisor {
  private readonly supervisor: ChildSupervisor;
  private readonly managed = new Map<string, ManagedChild>();
  private tray: Tray | null = null;
  private stopping = false;

  constructor(private readonly options: TraySupervisorOptions) {
    this.supervisor = new ChildSupervisor({
      restartBaseMs: 1_000,
      restartMaxMs: 30_000,
      stableUptimeMs: 30_000,
    });
  }

  /** 创建托盘并拉起两个子进程。Tray 创建失败（如无系统托盘）不致命：降级为无托盘监督。 */
  async start(): Promise<void> {
    for (const spec of this.childSpecs()) {
      this.supervisor.register(spec);
      this.managed.set(spec.name, { spec, process: null, killTimer: null });
      this.spawnChild(spec.name);
    }
    this.createTray();
  }

  /** before-quit 路径：SIGTERM → 5s → SIGKILL，两个子进程不残留。 */
  async stop(): Promise<void> {
    this.stopping = true;
    const children = [...this.managed.values()];
    for (const child of children) this.supervisor.requestStop(child.spec.name);
    for (const child of children) {
      child.process?.kill("SIGTERM");
    }
    const grace = new Promise((resolve) => setTimeout(resolve, 5_000));
    await Promise.race([
      Promise.all(children.map((child) => this.waitForExit(child))),
      grace,
    ]);
    for (const child of children) {
      if (child.process && child.process.exitCode === null) child.process.kill("SIGKILL");
    }
    this.destroyTray();
  }

  private waitForExit(child: ManagedChild): Promise<void> {
    return new Promise((resolve) => {
      if (!child.process || child.process.exitCode !== null) return resolve();
      child.process.once("exit", () => resolve());
    });
  }

  private childSpecs(): ChildSpec[] {
    const node = process.execPath;
    const runAsNode = { ELECTRON_RUN_AS_NODE: "1" };
    return [
      {
        name: "scheduler",
        command: node,
        args: [path.join(this.options.distDir, "monsoon", "scheduler-main.js")],
        env: { ...runAsNode, MS_DATA_DIR: this.options.dataDir },
      },
      {
        name: "executor",
        command: node,
        args: [path.join(this.options.distDir, "monsoon", "executor-main.js")],
        env: { ...runAsNode, MS_DATA_DIR: this.options.dataDir },
      },
    ];
  }

  private spawnChild(name: string): void {
    const managed = this.managed.get(name);
    if (!managed || this.stopping) return;
    const child = spawn(managed.spec.command, managed.spec.args ?? [], {
      env: { ...process.env, ...managed.spec.env },
      stdio: ["ignore", "inherit", "inherit"],
    });
    managed.process = child;
    this.supervisor.markRunning(name);
    child.on("exit", () => {
      managed.process = null;
      const { restart, delayMs } = this.supervisor.onChildExit(name);
      if (!restart) return;
      const maxRestarts = this.options.maxRestarts ?? 10;
      const status = this.supervisor.status().find((s) => s.name === name);
      if (status && status.attempts > maxRestarts) {
        console.error(`[ms-tray] ${name} 超过最大重启次数（${maxRestarts}），停止重启`);
        return;
      }
      setTimeout(() => this.spawnChild(name), delayMs);
    });
  }

  private createTray(): void {
    try {
      const icon = this.options.iconPath
        ? nativeImage.createFromPath(this.options.iconPath)
        : nativeImage.createEmpty();
      this.tray = new Tray(icon);
      this.tray.setToolTip("Monsoon");
      this.tray.setContextMenu(Menu.buildFromTemplate([
        { label: "打开窗口", click: () => this.options.showMainWindow() },
        { type: "separator" },
        { label: "重启调度器", click: () => this.restartChild("scheduler") },
        { label: "重启执行器", click: () => this.restartChild("executor") },
        { type: "separator" },
        {
          label: "停止全部并退出",
          click: () => {
            void this.stop().then(() => app.quit());
          },
        },
      ]));
    } catch (error) {
      // 无系统托盘（如部分 Linux 会话）时降级：子进程仍受 supervisor 监督。
      console.error("[ms-tray] 托盘创建失败，降级为无托盘监督", error);
      this.tray = null;
    }
  }

  private restartChild(name: string): void {
    const managed = this.managed.get(name);
    if (!managed) return;
    managed.process?.kill("SIGTERM");
    // exit 回调会按退避策略自动重启；显式菜单重启立即执行一次。
    if (!managed.process) this.spawnChild(name);
  }

  private destroyTray(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
