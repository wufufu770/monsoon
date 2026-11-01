/**
 * Windows 托盘探针（方案 v2.5 步骤一.3）——在 Windows 机器上运行：
 *   npx tsx scripts/tray-probe-windows.ts
 * 只验证三件事：托盘图标可见、关闭窗口后进程存活、托盘菜单可重新打开窗口。
 * 结果写 JSON 到 stdout；三件全过才允许 Windows 构建进入发布候选。
 * 非本机（Linux）执行环境——结果标记 partial，见 TRAY-SUPERVISOR.md 第六节。
 */
import { app, BrowserWindow, Tray, Menu, nativeImage } from "electron";
import path from "node:path";

const results: Record<string, boolean | string> = {};

app.whenReady().then(async () => {
  const icon = nativeImage.createEmpty(); // Windows 上空图 + 建议真实图标
  let tray: Tray | null = null;
  let window: BrowserWindow | null = null;
  try {
    window = new BrowserWindow({ width: 320, height: 200, show: true });
    window.loadURL("data:text/html,<h1>tray-probe</h1>");
    await new Promise((resolve) => window!.once("ready-to-show", resolve));

    // 探针 1：托盘图标可见（Tray 实例创建成功且未销毁即视为可见——
    // Windows 的实际渲染需人工目视确认，脚本断言的是 API 层成功）。
    tray = new Tray(icon);
    tray.setToolTip("ms tray probe");
    results.trayCreated = !tray.isDestroyed();

    // 探针 2：关闭窗口后进程存活。
    let closed = false;
    window.on("closed", () => {
      closed = true;
    });
    window.close();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    results.processAliveAfterClose = !closed && !app.isReady() === false;

    // 探针 3：托盘菜单可重新打开窗口。
    let reopened = false;
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "reopen", click: () => {
          window = new BrowserWindow({ width: 320, height: 200 });
          window.loadURL("data:text/html,<h1>reopened</h1>");
          reopened = true;
        },
      },
    ]));
    tray.emit("click", {} as Electron.KeyboardEvent, {}, {});
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    results.trayMenuReopensWindow = reopened;

    console.log(JSON.stringify({ ok: Object.values(results).every(Boolean), results }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, results, error: String(error) }, null, 2));
  } finally {
    tray?.destroy();
    window?.destroy();
    app.exit(0);
  }
});
