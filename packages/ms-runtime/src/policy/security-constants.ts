/**
 * ms 安全边界常量（方案 v2.5 步骤八，reArtex 语义）。
 *
 * reArtex 核心主张：安全边界从可热改 DB/settings 移到代码常量——关闭防线只剩
 * 编译期开关 + 重启。本文件的一切导出都是**代码常量或启动期不可变对象**：
 * 不从 SQLite、环境变量或任何配置文件读取。修改它们 = 修改代码 = 走完整审查。
 *
 * 可以调的参数（预算、窗口时长等非安全边界值）放在各自模块的可选构造参数里，
 * 不进入本文件。
 */

/** 工具副作用的有序等级：序号越大，后果越不可逆。 */
export const SIDE_EFFECT_LEVELS = ["read", "write", "destructive", "irreversible"] as const;
export type SideEffectLevel = (typeof SIDE_EFFECT_LEVELS)[number];

/** 执行域（方案 6.1 节）：本机或中心侧。集中定义避免多处漂移。 */
export type ExecutionDomain = "local" | "remote";

/** 高危等级：调用前强制走 PreExecutionProof（本地校验），门槛不由中心或本机配置决定。 */
export const HIGH_RISK_SIDE_EFFECT_LEVELS: readonly SideEffectLevel[] = [
  "destructive",
  "irreversible",
];

/**
 * 联网声明的缺省语义（步骤五）：缺省一律按"可能联网"（undeclared）处理，
 * 取更保守的一侧。该缺省是代码常量，不可通过配置改为更宽松的取值。
 */
export const DEFAULT_NETWORK_ACCESS = "undeclared" as const;
export type NetworkAccess = "none" | "declared" | "undeclared";

/**
 * 凭证路径绊线（步骤五）——按用户主目录相对前缀匹配，跨平台覆盖四类既知凭证目录。
 * 绊线是绊线不是边界：它降低中介访问误触的概率，防不住绕过中介直接读文件
 * （那是方案书 3.2 节命题二的范畴，由信任模型披露）。
 */
export interface CredentialGuardRule {
  /** 稳定标识，进审计事件。 */
  readonly id: string;
  /** 审计展示名。 */
  readonly label: string;
  /** 用户主目录下的相对前缀（POSIX 形式，匹配时做跨平台归一）。 */
  readonly homeRelativePrefixes: readonly string[];
}

export const CREDENTIAL_GUARD_RULES: readonly CredentialGuardRule[] = [
  {
    id: "ssh",
    label: "SSH 配置与密钥目录",
    homeRelativePrefixes: [".ssh"],
  },
  {
    id: "gnupg",
    label: "GnuPG 私钥环",
    homeRelativePrefixes: [".gnupg"],
  },
  {
    id: "cloud-credentials",
    label: "云厂商凭证目录",
    homeRelativePrefixes: [".aws", ".config/gcloud", ".azure", ".kube"],
  },
  {
    id: "browser-credentials",
    label: "浏览器凭证库",
    homeRelativePrefixes: [
      ".mozilla/firefox",
      ".config/google-chrome",
      ".config/chromium",
      "Library/Application Support/Google/Chrome",
      "Library/Application Support/Firefox",
    ],
  },
  {
    id: "certificate-stores",
    label: "证书私钥目录",
    homeRelativePrefixes: [".ssl/private", "Library/Keychains"],
  },
] as const;

/**
 * 沙箱/执行边界的强制完整度（dsh 语义采纳）：承认部分强制比假装强制更安全。
 * 判定条件是代码常量：只有容器级边界报告为可信时才允许上报 full；
 * 宿主中介（文件根限制 + 命令放行检查）永远只算 partial。
 */
export type EnforcementFullness = "full" | "partial";

export interface EnforcementInput {
  /** 执行边界种类：container=容器级；host-mediated=宿主中介；none=无。 */
  readonly boundaryKind: "container" | "host-mediated" | "none";
  /** 容器边界是否通过了启动时校验（镜像摘要核对等）。 */
  readonly containerVerified?: boolean;
}

export function enforcementFullness(input: EnforcementInput): EnforcementFullness {
  if (input.boundaryKind === "container" && input.containerVerified === true) return "full";
  return "partial";
}
