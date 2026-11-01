import { describe, expect, it } from "vitest";
import { evaluateCredentialGuard } from "./credential-guard.js";

const HOME = "/home/tester";

describe("凭证路径绊线（步骤五.2）", () => {
  it("拒绝 SSH 目录本身与子路径", () => {
    expect(evaluateCredentialGuard(`${HOME}/.ssh`, HOME).allowed).toBe(false);
    expect(evaluateCredentialGuard(`${HOME}/.ssh/id_ed25519`, HOME).allowed).toBe(false);
    expect(evaluateCredentialGuard(`${HOME}/.ssh/../.ssh/id_rsa`, HOME).allowed).toBe(false);
  });

  it("拒绝云凭证与浏览器凭证目录", () => {
    expect(evaluateCredentialGuard(`${HOME}/.aws/credentials`, HOME).allowed).toBe(false);
    expect(evaluateCredentialGuard(`${HOME}/.config/gcloud/credentials.db`, HOME).allowed).toBe(false);
    expect(evaluateCredentialGuard(`${HOME}/.mozilla/firefox/logins.json`, HOME).allowed).toBe(false);
  });

  it("~ 写法同样命中", () => {
    expect(evaluateCredentialGuard("~/.ssh/config", HOME).allowed).toBe(false);
  });

  it("前缀相似但非同目录不误伤（无静默放行之外的假阳性）", () => {
    expect(evaluateCredentialGuard(`${HOME}/.sshx/notes.txt`, HOME).allowed).toBe(true);
    expect(evaluateCredentialGuard(`${HOME}/Documents/report.md`, HOME).allowed).toBe(true);
  });

  it("拒绝时给出规则标识，供审计入链", () => {
    const verdict = evaluateCredentialGuard(`${HOME}/.aws/credentials`, HOME);
    expect(verdict.rule?.id).toBe("cloud-credentials");
  });
});
