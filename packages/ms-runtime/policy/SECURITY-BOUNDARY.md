# 安全边界：代码常量与审计链（步骤八，reArtex 语义）

> 拍板三/拍板十六的工程载体。**VERDICT: PASS**（文末）。

## 一、哪些是代码常量（不可热改）

| 常量 | 文件 | 语义 |
|---|---|---|
| `CREDENTIAL_GUARD_RULES` | `packages/ms-runtime/src/policy/security-constants.ts` | 凭证路径绊线的完整清单（SSH/GnuPG/云凭证/浏览器凭证/证书私钥，五类） |
| `DEFAULT_NETWORK_ACCESS` | 同上 | 固定为 `"undeclared"`——缺省按可能联网处理，**不可配置为更宽松** |
| `HIGH_RISK_SIDE_EFFECT_LEVELS` | 同上 | destructive/irreversible 两级强制 PreExecutionProof；且测试锁定其必须为全集中最后两级（防改弱） |
| `SIDE_EFFECT_LEVELS` | 同上 | 副作用等级的有序全集 |
| `enforcementFullness()` 判定 | 同上 | 容器校验通过=full；宿主中介/无边界=partial（dsh 诚实上报语义） |
| 高危转人工门槛 | `src/executor/pre-execution-proof.ts` | 高危等级 + 范围外 ⇒ `requiresHumanIntervention=true`，不由中心或本机配置决定 |

**验证**：修改本机 SQLite 中的任何绊线/门槛配置不会改变拦截行为——因为拦截根本不读配置；
测试 `security-constants.test.ts` 锁定常量本身。

## 二、哪些是可调参数（非安全边界）

| 参数 | 位置 | 缺省 |
|---|---|---|
| 去重窗口 | `EventGateway` 构造参数 | 5 分钟 |
| 每来源唤醒预算 | `WakeupBudget` 构造参数 | 60 次/60 秒 |
| 事件白名单 | `EventGateway` 构造参数 | 调用方给定（策略资产，非边界） |

## 三、审计哈希链（步骤八.3）

- `AuditChain`：seq 连续 + `current_hash = SHA256(canonical(事件域))`，
  创世 `prev_hash = 0×64`；canonical 序列化 = 排序键紧凑 JSON。
- **判定动作（拦截、放行、回滚）必须入链**：credential-guard 拒绝、
  pre-execution-proof 的每个 failure 与 pass、reconcile 回滚触发。
- 本机链是独立链（方案 5.5 节）：与 Loom 中心链不做哈希衔接，补交时中心侧
  校验的是**链内连续性**。测试覆盖：篡改载荷定位断点、删除中间条目破坏衔接。

## 四、热改配置为什么绕不过

1. 绊线清单、高危门槛、联网缺省**编译进 bundle**——改它们等于改代码，走完整审查
   与发布；运行期的 SQLite/环境变量里没有这些值。
2. 本机执行域策略的"批准范围"来自中心批准的计划（本地投影），只能**收窄**
   常量边界，不能放大（runPreExecutionProof 的判定是交集语义）。
3. 判定动作强制入链——绕过防线而留下无链记录，本身即审计异常。

---

**VERDICT: PASS**

（生产者自检结论：常量清单与代码一一对应；测试 5 文件 21 例全绿；
"哪些可调/哪些不可调"各有出处。）
