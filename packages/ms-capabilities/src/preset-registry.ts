/**
 * 运行预设（方案 v2.5 批次五）：能力组合成可复用的任务模板——
 * 模板标识到（能力名 + 参数契约）的注册表。补 Loom 域包模板缺的参数契约
 * （方案 7.4 节的 ms 侧落点）；模板标识必填、参数校验拒绝而非降级。
 */
export interface RuntimePreset {
  readonly id: string;
  readonly description: string;
  /** 该预设允许调用的工具名（allowed_tools，模型会话的白名单）。 */
  readonly allowedTools: readonly string[];
  /** 参数契约（JSON Schema；校验失败拒绝而非降级）。 */
  readonly paramSchema: Record<string, unknown>;
}

export class PresetRegistry {
  private readonly presets = new Map<string, RuntimePreset>();

  register(preset: RuntimePreset): void {
    this.presets.set(preset.id, preset);
  }

  get(id: string): RuntimePreset | undefined {
    return this.presets.get(id);
  }

  all(): readonly RuntimePreset[] {
    return [...this.presets.values()];
  }

  /** 模板化委托的第一道门：模板必填、参数校验拒绝（拍板：不做降级）。 */
  resolveWithParams(id: string, params: Record<string, unknown>): {
    ok: boolean;
    preset?: RuntimePreset;
    errors: readonly string[];
  } {
    const preset = this.presets.get(id);
    if (!preset) return { ok: false, errors: [`未知模板: ${id}`] };
    const errors: string[] = [];
    const required = (preset.paramSchema["required"] as readonly string[] | undefined) ?? [];
    for (const key of required) {
      if (params[key] === undefined) errors.push(`缺少必填参数: ${key}`);
    }
    const properties = (preset.paramSchema["properties"] as Record<string, { type?: string }> | undefined) ?? {};
    for (const [key, value] of Object.entries(params)) {
      const expected = properties[key]?.type;
      if (expected === undefined) continue;
      const actual = Array.isArray(value) ? "array" : typeof value;
      const compatible = expected === actual
        || (expected === "number" && actual === "number")
        || (expected === "integer" && actual === "number" && Number.isInteger(value))
        || (expected === "string" && actual === "string");
      if (!compatible) errors.push(`参数 ${key} 类型应为 ${expected}，实为 ${actual}`);
    }
    return errors.length === 0 ? { ok: true, preset, errors } : { ok: false, preset, errors };
  }
}
