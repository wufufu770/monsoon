/**
 * 六态汇报 schema（方案 v2.5 拍板十八，super-agent Report 语义吸收）：
 * ms→Loom 的汇报协议——progress/waiting/ready/blocked/failed/dropped，
 * 人工提问是结构化字段（human_action），问题可路由回来源（questionFor）。
 */
export type ReportState = "progress" | "waiting" | "ready" | "blocked" | "failed" | "dropped";

export interface HumanAction {
  /** 一次只问一个具体结构化问题（super-agent 纪律）。 */
  readonly question: string;
  readonly options?: readonly string[];
}

export interface TaskReport {
  readonly taskId: string;
  readonly state: ReportState;
  readonly detail?: string;
  /** 需要人决策时的结构化提问；state=waiting/blocked 时可携带。 */
  readonly humanAction?: HumanAction;
  /** 问题路由回来源（原消息/触发标识），审计链完整。 */
  readonly questionFor?: string;
}

export function buildReport(report: TaskReport): TaskReport {
  if ((report.state === "waiting" || report.state === "blocked") && report.humanAction === undefined) {
    throw new Error(`${report.state} 态必须携带 human_action 结构化提问`);
  }
  return report;
}
