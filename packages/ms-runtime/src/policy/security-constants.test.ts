import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_GUARD_RULES,
  DEFAULT_NETWORK_ACCESS,
  enforcementFullness,
  HIGH_RISK_SIDE_EFFECT_LEVELS,
  SIDE_EFFECT_LEVELS,
} from "./security-constants.js";

describe("安全边界常量（步骤八.1）", () => {
  it("联网缺省固定为 undeclared，不可配置", () => {
    expect(DEFAULT_NETWORK_ACCESS).toBe("undeclared");
  });

  it("高危等级门槛由常量定义且包含不可逆等级", () => {
    expect(HIGH_RISK_SIDE_EFFECT_LEVELS).toContain("irreversible");
    expect(HIGH_RISK_SIDE_EFFECT_LEVELS).toContain("destructive");
    // 高危集合必须是全集中序号最大的两个，防止常量被改弱后无人察觉。
    expect([...SIDE_EFFECT_LEVELS].slice(-2)).toEqual([...HIGH_RISK_SIDE_EFFECT_LEVELS]);
  });

  it("绊线规则覆盖四类既知凭证目录", () => {
    const ids = CREDENTIAL_GUARD_RULES.map((rule) => rule.id);
    expect(ids).toEqual(
      expect.arrayContaining(["ssh", "gnupg", "cloud-credentials", "browser-credentials", "certificate-stores"]),
    );
  });

  it("强制完整度判定：容器校验通过才是 full，宿主中介永远 partial", () => {
    expect(enforcementFullness({ boundaryKind: "container", containerVerified: true })).toBe("full");
    expect(enforcementFullness({ boundaryKind: "container", containerVerified: false })).toBe("partial");
    expect(enforcementFullness({ boundaryKind: "host-mediated" })).toBe("partial");
    expect(enforcementFullness({ boundaryKind: "none" })).toBe("partial");
  });
});
