/** 步骤六示例的可编译性验证（docs/skill-declaration-template.md 第三节）。
 *  本文件由验证脚本临时创建/删除；保留即说明示例漂移。 */
import type { ConnectorTool } from "@rakazo/adapter-kit";

export const workspaceFileSearch: ConnectorTool = {
  name: "workspace.file-search",
  description:
    "在用户主目录的工作区文件中按关键词搜索文件名与内容（只读，不出网）。" +
    "Use when: 用户要求查找/定位文件、按名字或内容搜索工作区、" +
    "列出最近修改的文件。边界：不做写入/删除/移动；不读取凭证目录" +
    "（.ssh/.aws/.gnupg/浏览器凭证库等由绊线拒绝）；不访问工作区之外。",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1 },
      glob: { type: "string" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  readOnly: true,
  networkAccess: "none",
  rollback: false,
};

export const workspaceFileReplace: ConnectorTool = {
  name: "workspace.file-replace",
  description: "工作区内精确文本替换（写操作，需审批门）。",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      original: { type: "string", minLength: 1 },
      replacement: { type: "string" },
    },
    required: ["path", "original", "replacement"],
    additionalProperties: false,
  },
  readOnly: false,
  networkAccess: "none",
  rollback: true,
};
