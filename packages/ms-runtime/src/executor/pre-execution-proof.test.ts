import { describe, expect, it } from "vitest";
import { runPreExecutionProof } from "./pre-execution-proof.js";

const HOME = "/home/tester";
const LOCAL_POLICY = {
  executionDomain: "local" as const,
  approvedSideEffectLevels: ["read", "write"] as const,
};
const REMOTE_POLICY = {
  executionDomain: "remote" as const,
  approvedSideEffectLevels: ["read", "write"] as const,
};

describe("执行前安全证明（步骤七）", () => {
  it("批准范围内且无绊线的调用通过", () => {
    const result = runPreExecutionProof(
      { tool: { name: "fs.write", readOnly: false, networkAccess: "none" }, sideEffectLevel: "write", homeDir: HOME },
      LOCAL_POLICY,
    );
    expect(result.ok).toBe(true);
    expect(result.requiresHumanIntervention).toBe(false);
  });

  it("副作用等级超出批准范围被拦截（验收项）", () => {
    const result = runPreExecutionProof(
      { tool: { name: "disk.format", readOnly: false }, sideEffectLevel: "irreversible", homeDir: HOME },
      LOCAL_POLICY,
    );
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.code)).toContain("side_effect_level_out_of_scope");
    expect(result.requiresHumanIntervention).toBe(true);
  });

  it("remote 域的 undeclared 写工具被拦，local 域仅披露不拦截", () => {
    const tool = { name: "http.call", readOnly: false, networkAccess: "undeclared" as const };
    const remote = runPreExecutionProof(
      { tool, sideEffectLevel: "write", homeDir: HOME },
      REMOTE_POLICY,
    );
    expect(remote.failures.map((f) => f.code)).toContain("network_policy_mismatch");
    const local = runPreExecutionProof(
      { tool, sideEffectLevel: "write", homeDir: HOME },
      LOCAL_POLICY,
    );
    expect(local.ok).toBe(true);
  });

  it("凭证路径绊线命中即拒绝并要求人工介入（验收项）", () => {
    const result = runPreExecutionProof(
      {
        tool: { name: "fs.read", readOnly: true, networkAccess: "none" },
        sideEffectLevel: "read",
        requestedPath: `${HOME}/.ssh/id_ed25519`,
        homeDir: HOME,
      },
      LOCAL_POLICY,
    );
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.code)).toContain("credential_tripwire");
    expect(result.requiresHumanIntervention).toBe(true);
  });
});
