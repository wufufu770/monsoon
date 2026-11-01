/**
 * 本地审计哈希链（方案 v2.5 步骤八.3）。
 *
 * 与 Loom 的事件链校验语义对齐：序号连续、current_hash = H(prev_hash ∖‖ 事件内容)，
 * 判定动作（拦截、放行、回滚）必须入链。本机链是独立链标识下的链内连续性
 * （方案 5.5 节），与中心链不要求哈希衔接。
 *
 * 零依赖：哈希用 node:crypto，规范序列化用排序键 JSON。
 */
import { createHash } from "node:crypto";

const GENESIS_PREV_HASH = "0".repeat(64);

export interface AuditEvent {
  readonly seq: number;
  readonly timestamp: string;
  readonly type: string;
  /** 判定动作或事件主体；拦截/放行/回滚等判定必须入链。 */
  readonly actor: string;
  readonly payload: Record<string, unknown>;
  readonly prevHash: string;
  readonly hash: string;
}

export interface AuditEventInput {
  readonly type: string;
  readonly actor: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp?: string;
}

/** 规范序列化：排序键的紧凑 JSON，保证同内容同哈希。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

function eventHash(fields: Omit<AuditEvent, "hash">): string {
  return createHash("sha256").update(canonicalJson(fields)).digest("hex");
}

export class AuditChain {
  private events: AuditEvent[] = [];

  /** 从外部存储恢复（恢复时必须跑 verify）。 */
  static from(existing: readonly AuditEvent[]): AuditChain {
    const chain = new AuditChain();
    chain.events = [...existing];
    return chain;
  }

  append(input: AuditEventInput): AuditEvent {
    const prev = this.events[this.events.length - 1];
    const fields = {
      seq: prev ? prev.seq + 1 : 0,
      timestamp: input.timestamp ?? new Date().toISOString(),
      type: input.type,
      actor: input.actor,
      payload: input.payload,
      prevHash: prev ? prev.hash : GENESIS_PREV_HASH,
    };
    const event: AuditEvent = { ...fields, hash: eventHash(fields) };
    this.events.push(event);
    return event;
  }

  all(): readonly AuditEvent[] {
    return this.events;
  }

  /**
   * 链校验：逐条重算哈希并核对 prev 衔接。任何一处被改写（载荷、顺序、
   * 删除条目）都会使校验失败，并返回首个断裂位置。
   */
  verify(): { ok: boolean; brokenAt: number | null } {
    let expectedPrev = GENESIS_PREV_HASH;
    for (const event of this.events) {
      if (event.prevHash !== expectedPrev) return { ok: false, brokenAt: event.seq };
      const { hash: claimed, ...fields } = event;
      if (eventHash(fields) !== claimed) return { ok: false, brokenAt: event.seq };
      expectedPrev = claimed;
    }
    return { ok: true, brokenAt: null };
  }
}
