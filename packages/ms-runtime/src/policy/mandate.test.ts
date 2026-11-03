import { describe, expect, it } from "vitest";
import { admissionDecide } from "./admission.js";
import { revalidateMandate, type Mandate } from "./mandate.js";
import { buildReport } from "../executor/report.js";

describe("Mandate 任务级凭证（拍板十八）", () => {
  const mandate: Mandate = {
    strength: "standard", policyVersion: "pv-7",
    basis: { via: "admission", source: "loom" }, actor: "user-1",
    scope: { executionDomain: "local", sideEffectLevels: ["read", "write"] },
  };
  it("策略版本一致、范围包含 → proceed", () => {
    expect(revalidateMandate(mandate, {
      currentPolicyVersion: "pv-7", executionDomain: "local", requestedLevel: "write",
    }).verdict).toBe("proceed");
  });
  it("策略版本变更 → reject", () => {
    expect(revalidateMandate(mandate, {
      currentPolicyVersion: "pv-8", executionDomain: "local", requestedLevel: "read",
    }).verdict).toBe("reject");
  });
  it("等级超范围 → reject", () => {
    expect(revalidateMandate(mandate, {
      currentPolicyVersion: "pv-7", executionDomain: "local", requestedLevel: "irreversible",
    }).verdict).toBe("reject");
  });
});

describe("observe 灰度档（拍板十八）", () => {
  const event = { id: "e", source: "loom", type: "task.queued", payload: {}, dedupKey: "k", timestamp: 0 };
  it("observe：通过门也只记录不执行", () => {
    const decision = admissionDecide("observe", true, event);
    expect(decision.accepted).toBe(false);
    expect(decision.wouldAccept).toBe(true);
  });
  it("auto：通过门即接受", () => {
    expect(admissionDecide("auto", true, event).accepted).toBe(true);
  });
  it("off：全拒", () => {
    expect(admissionDecide("off", true, event).accepted).toBe(false);
  });
});

describe("六态汇报（拍板十八）", () => {
  it("waiting/blocked 必须带 human_action", () => {
    expect(() => buildReport({ taskId: "t", state: "waiting" })).toThrow();
    expect(buildReport({
      taskId: "t", state: "waiting",
      humanAction: { question: "是否覆盖输出文件？", options: ["覆盖", "另存"] },
      questionFor: "trigger-7",
    }).humanAction?.question).toContain("覆盖");
  });
  it("ready/failed 无需 human_action", () => {
    expect(buildReport({ taskId: "t", state: "ready" }).state).toBe("ready");
  });
});
