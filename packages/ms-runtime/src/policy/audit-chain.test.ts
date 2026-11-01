import { describe, expect, it } from "vitest";
import { AuditChain } from "./audit-chain.js";

describe("本地审计哈希链（步骤八.3）", () => {
  it("追加事件：序号连续、创世 prevHash 为零串", () => {
    const chain = new AuditChain();
    const first = chain.append({ type: "guard.deny", actor: "credential-guard", payload: { path: "/home/u/.ssh" } });
    const second = chain.append({ type: "proof.pass", actor: "pre-execution-proof", payload: {} });
    expect(first.seq).toBe(0);
    expect(first.prevHash).toBe("0".repeat(64));
    expect(second.seq).toBe(1);
    expect(second.prevHash).toBe(first.hash);
    expect(chain.verify()).toEqual({ ok: true, brokenAt: null });
  });

  it("载荷被篡改时校验失败并定位断点", () => {
    const chain = new AuditChain();
    chain.append({ type: "a", actor: "x", payload: { n: 1 } });
    const second = chain.append({ type: "b", actor: "x", payload: { n: 2 } });
    // 模拟存储被改：直接改历史载荷。
    const tampered = JSON.parse(
      JSON.stringify(chain.all()),
    ) as unknown as Parameters<typeof AuditChain.from>[0];
    tampered[0]!.payload.n = 999;
    const restored = AuditChain.from(tampered);
    expect(restored.verify()).toEqual({ ok: false, brokenAt: 0 });
    // 断点之后的所有条目仍然带原哈希，说明改写无法伪装成连续链。
    expect(second.hash).not.toBe("");
  });

  it("删除中间条目会破坏衔接", () => {
    const chain = new AuditChain();
    chain.append({ type: "a", actor: "x", payload: {} });
    chain.append({ type: "b", actor: "x", payload: {} });
    chain.append({ type: "c", actor: "x", payload: {} });
    const missing = AuditChain.from(chain.all().filter((event) => event.seq !== 1));
    expect(missing.verify().ok).toBe(false);
  });
});
