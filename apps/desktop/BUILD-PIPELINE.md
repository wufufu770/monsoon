# ms 构建管线（步骤 B）

> 产物：`apps/desktop/out/Monsoon-0.3.6.AppImage`（167,798,031 B，未签名）。
> **VERDICT: PASS（干净机器验证待实机）**（文末）。

## 一、构建命令

```bash
pnpm install                       # 工作区链接（含 @monsoon/* 与 pi-durable@1.4.0）
pnpm --filter @rakazo/web build    # renderer（web 控制台）
pnpm --filter @rakazo/desktop build
   # = esbuild 三入口（main.js + monsoon/scheduler-main.js + monsoon/executor-main.js）
   #   + copy-static（preload/setup）+ build-speech
npx electron-builder --linux AppImage --publish never
```

## 二、产物结构（实测 asar 清单）

| 内容 | 位置 | 打包方式 |
|---|---|---|
| 托盘主进程 | `dist/main.js` | esbuild bundle（ms-runtime 内联） |
| 调度器/执行器子进程入口 | `dist/monsoon/{scheduler,executor}-main.js` | 同上，三入口共用一次 bundle |
| pi-durable@1.4.0 | `node_modules/@earendil-works/pi-durable`（310 个文件入 asar） | 生产依赖自动收入；其 Node SQLite 用 node:sqlite 内置模块，**无原生 addon** |
| renderer | `resources/web`（extraResources） | web 构建产物 |
| 本机栈 compose | `resources/stack`（extraResources） | 过渡期 Docker 栈承载 |

关键点：三入口 **bundle 时内联 `@monsoon/ms-runtime`**（esbuild bundle:true），
打包后不依赖 workspace 链接；`require.resolve` 验证由 asar 清单替代确认
（dist/monsoon/* 三个入口都在包内）。

## 三、数据目录（不在 asar 内）

| 库 | 路径 | 用途 |
|---|---|---|
| scheduler.db | `app.getPath('userData')/ms-data/` | 触发规则/队列/待交产物 |
| executor.db | 同上 | 审计哈希链 |
| executor-durable.db | 同上 | pi-durable 检查点（文件级，userData 用户可写 ✓） |

## 四、干净机器验证结果

| 项 | 结果 |
|---|---|
| AppImage 构建 | ✓（本机 Linux，2026-11-02） |
| asar 内三入口 + pi-durable | ✓（asar list 实测） |
| 干净机器/全新虚拟机启动 + 托盘 + 子进程 + 本地任务 | **待实机**——本机即开发机（含 workspace/node_modules），不构成干净环境；验证步骤：拷贝 AppImage 至干净 Linux → 安装运行 → 任务管理器确认三进程 → 派活 echo 任务 → userData 下见三库 |

## 五、已知取舍

- 未签名、未公证（不做清单）。
- macOS/Windows 打包待各自实机（Windows 另需托盘探针通过，见
  TRAY-SUPERVISOR.md 第六节）。
- pi-durable 存储在 asar 外的用户目录创建——首次运行时初始化，
  无需安装期动作。

---

**VERDICT: PASS（partial：干净机器验证待实机）**

（生产者自检结论：构建命令与产物结构实测；三入口与 pi-durable 打包确认；
数据目录位置符合"用户可写路径"要求；干净机器项如实标注待实机。）
