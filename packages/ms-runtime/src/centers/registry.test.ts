import { describe, expect, it } from "vitest";
import { CenterRegistry, determineForm, resolveEffectiveExecutionDomain } from "./registry.js";

describe("中心注册表与多中心（批次四）", () => {
  it("注册与加权轮询：等权轮转、权重高的先被选", () => {
    const registry = new CenterRegistry();
    registry.register({ centerId: "a", baseUrl: "http://a", operatorToken: "o", workerToken: "w", tenantId: "t" });
    registry.register({ centerId: "b", baseUrl: "http://b", operatorToken: "o", workerToken: "w", tenantId: "t", weight: 3 });
    const picked = [registry.pickOnline()!.centerId, registry.pickOnline()!.centerId,
      registry.pickOnline()!.centerId, registry.pickOnline()!.centerId];
    // 权重 1:3 → b 出现 3 次、a 出现 1 次（平滑 WRR）。
    expect(picked.filter((id) => id === "b")).toHaveLength(3);
    expect(picked).toContain("a");
  });

  it("per-center 失联：连续 3 次失败才离线，成功即恢复；只冻结该中心", () => {
    const registry = new CenterRegistry();
    registry.register({ centerId: "a", baseUrl: "http://a", operatorToken: "o", workerToken: "w", tenantId: "t" });
    registry.register({ centerId: "b", baseUrl: "http://b", operatorToken: "o", workerToken: "w", tenantId: "t" });
    expect(registry.markFailure("a")).toBe("online");
    expect(registry.markFailure("a")).toBe("online");
    expect(registry.markFailure("a")).toBe("offline");
    // 只冻结 a，b 仍可被选中。
    expect(registry.pickOnline()!.centerId).toBe("b");
    expect(registry.markSuccess("a")).toBe("online");
    expect(registry.all().every((c) => c.status === "online")).toBe(true);
  });

  it("事件游标：每中心独立（判据 A3）", () => {
    const registry = new CenterRegistry();
    registry.register({ centerId: "a", baseUrl: "http://a", operatorToken: "o", workerToken: "w", tenantId: "t" });
    registry.register({ centerId: "b", baseUrl: "http://b", operatorToken: "o", workerToken: "w", tenantId: "t" });
    registry.advanceCursor("a", 10);
    registry.advanceCursor("b", 5);
    expect(registry.get("a")!.cursor).toBe(10);
    expect(registry.get("b")!.cursor).toBe(5);
  });

  it("形态判定：计数来自中心侧登记，不读本机", () => {
    expect(determineForm(0)).toBe("standalone");
    expect(determineForm(1)).toBe("combined");
    expect(determineForm(2)).toBe("multi-center");
  });

  it("生效执行域：三处显示共用同一函数（拍板一）", () => {
    expect(resolveEffectiveExecutionDomain("local", null)).toEqual({ domain: "local", source: "inherited" });
    expect(resolveEffectiveExecutionDomain("local", "remote")).toEqual({ domain: "remote", source: "override" });
  });
});
