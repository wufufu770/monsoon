import { describe, expect, it } from "vitest";
import { AuditChain } from "@monsoon/ms-runtime/policy";
import { disclosureText, recordInstallDisclosure } from "./install-disclosure.js";
import { PresetRegistry } from "./preset-registry.js";

describe("安装披露（判据 G9 的 ms 侧）", () => {
  it("缺省折叠：未声明联网按 undeclared（保守侧，代码常量）", () => {
    const audit = new AuditChain();
    const effective = recordInstallDisclosure(audit, {
      name: "web.fetch", readOnly: true, rollback: false,
      networkAccess: undefined as never, sideEffectLevel: "read",
    });
    expect(effective.networkAccess).toBe("undeclared");
    expect(audit.all().map((e) => e.type)).toEqual(["capability.installed"]);
    expect(disclosureText(effective)).toContain("按可能联网处理");
  });

  it("declared 与 none 的披露文案", () => {
    const audit = new AuditChain();
    const declared = recordInstallDisclosure(audit, {
      name: "http.call", readOnly: false, networkAccess: "declared",
      rollback: true, sideEffectLevel: "write",
    });
    expect(disclosureText(declared)).toContain("已声明需要联网");
    expect(disclosureText(declared)).toContain("支持回滚");
  });
});

describe("运行预设注册表（批次五）", () => {
  const registry = new PresetRegistry();
  registry.register({
    id: "wordcount", description: "统计文本词数",
    allowedTools: ["fs.read"],
    paramSchema: {
      type: "object",
      properties: { path: { type: "string" }, limit: { type: "integer" } },
      required: ["path"],
    },
  });

  it("模板标识必填：未知模板拒绝（判据 D2）", () => {
    const result = registry.resolveWithParams("nope", {});
    expect(result.ok).toBe(false);
  });

  it("参数契约拒绝非法参数且给全错误清单（判据 D1，拒绝不降级）", () => {
    const result = registry.resolveWithParams("wordcount", { limit: "many" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("path"))).toBe(true);
    expect(result.errors.some((e) => e.includes("limit"))).toBe(true);
  });

  it("合法参数通过", () => {
    expect(registry.resolveWithParams("wordcount", { path: "a.md", limit: 5 }).ok).toBe(true);
  });
});
