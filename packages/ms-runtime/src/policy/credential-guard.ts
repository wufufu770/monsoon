/**
 * 凭证路径绊线（方案 v2.5 步骤五，宿主中介层）。
 *
 * 语义：对既知凭证路径的**中介**访问一律拒绝并产出审计事件，显式上报、
 * 不许静默。绊线是绊线不是边界——它防不住插件进程绕过中介直接读文件。
 * 规则清单来自 security-constants.ts 的代码常量，运行期不可增删。
 */
import { CREDENTIAL_GUARD_RULES, type CredentialGuardRule } from "./security-constants.js";
import { normalize } from "node:path";

export interface CredentialGuardVerdict {
  readonly allowed: boolean;
  /** 命中的规则；allowed=true 时为 null。 */
  readonly rule: CredentialGuardRule | null;
  /** 归一化后参与判定的路径。 */
  readonly normalizedPath: string;
}

/** 归一化：统一分隔符、解 `~`、消 `..`。不做存在性检查——绊线只看字面路径。 */
export function normalizeGuardPath(inputPath: string, homeDir: string): string {
  let candidate = inputPath;
  if (candidate === "~" || candidate.startsWith("~/")) {
    candidate = homeDir + candidate.slice(1);
  }
  const resolved = normalize(candidate);
  return resolved;
}

function matchesRule(normalizedPath: string, homeDir: string, rule: CredentialGuardRule): boolean {
  for (const prefix of rule.homeRelativePrefixes) {
    const absolutePrefix = normalize(homeDir + "/" + prefix);
    // 目录前缀命中（含目录本身与子路径）；用分隔符收尾防止 "foo-bar" 命中 "foo"。
    if (normalizedPath === absolutePrefix || normalizedPath.startsWith(absolutePrefix + "/")) {
      return true;
    }
  }
  return false;
}

/** 对一次中介文件访问做绊线判定。拒绝时调用方必须写审计事件并显式上报。 */
export function evaluateCredentialGuard(
  inputPath: string,
  homeDir: string,
): CredentialGuardVerdict {
  const normalizedPath = normalizeGuardPath(inputPath, homeDir);
  for (const rule of CREDENTIAL_GUARD_RULES) {
    if (matchesRule(normalizedPath, homeDir, rule)) {
      return { allowed: false, rule, normalizedPath };
    }
  }
  return { allowed: true, rule: null, normalizedPath };
}
