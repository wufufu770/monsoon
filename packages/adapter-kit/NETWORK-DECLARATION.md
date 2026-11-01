# 联网声明与凭证路径绊线（步骤五）

> 定位：**披露不是门禁**。只读+联网有大量正当用途，强制审批会把可用性打穿；
> 这个档位下诚实的强度 = 披露 + 留痕 + 绊线。**VERDICT: PASS**（文末）。

## 一、联网声明（adapter-kit 扩展）

`packages/adapter-kit/src/types.ts` 的 `ConnectorTool` 新增：

```ts
networkAccess?: "none" | "declared" | "undeclared";
```

- `none`：工具不出网（与 `readOnly: true` 组合 = 可标记 replay-safe 的前提之一）。
- `declared`：允许联网，安装确认界面与调用审计事件显式披露。
- `undeclared`（缺省）：未声明，**按可能联网处理**；在调用界面披露
  "此能力可能联网"，不阻断。
- 缺省语义由 `@monsoon/ms-runtime` 的代码常量 `DEFAULT_NETWORK_ACCESS` 固定，
  不可配置放宽。

披露落点（接线在插件宿主安装/调用链，批次二）：安装确认界面三项
（能力名、readOnly、networkAccess）+ 调用审计事件携带三项（判据 G9 的 ms 侧）。

## 二、凭证路径绊线

`packages/ms-runtime/src/policy/credential-guard.ts`：

- 规则清单 = `CREDENTIAL_GUARD_RULES`（代码常量）：SSH（.ssh）、GnuPG（.gnupg）、
  云凭证（.aws/.config/gcloud/.azure/.kube）、浏览器凭证库（.mozilla/.config/google-chrome/
  .config/chromium/Library 两大目录）、证书私钥（.ssl/private/Library/Keychains）。
- `evaluateCredentialGuard(path, homeDir)`：归一化（~/ 展开、分隔符统一、.. 消解）
  后按目录前缀判定；**拒绝并产出规则标识**，调用方必须写审计事件（入哈希链）
  并显式上报，不许静默。
- 测试：目录本身/子路径/`~` 写法/前缀相似不误伤（`.sshx` 不命中 `.ssh`）。

## 三、与 PreExecutionProof 的衔接

`runPreExecutionProof` 的第四校验即绊线：命中 → `credential_tripwire` 失败 +
`requiresHumanIntervention=true`（门槛是代码常量）。

## 四、为什么不是门禁

命题二（方案 3.2 节）：插件进程本身以用户身份运行，不受中介约束——绊线防不住
进程直接读文件。它降低**中介层误触**概率并保证每次误触有审计记录；真正的边界
语义见 `SECURITY-BOUNDARY.md` 的三条命题。

---

**VERDICT: PASS**

（生产者自检结论：缺省语义有常量与测试锁定；绊线清单五类齐全且测试覆盖
命中/放行/误伤三面；披露落点注明接线批次。）
