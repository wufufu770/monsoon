"""RV 桥接器（方案 v2.5 批次五）：把 Realtime-Venus 的 AgentSkill/SkillRegistry
包装成 ms 的进程外 MCP stdio 能力插件。

协议：按行分隔的 JSON——tools/list / tools/call / cancel（与
@monsoon/ms-capabilities 的 McpStdioHost 约定一致）。

**真实导入 RV**：sys.path 注入 RV 仓库根，`from harness.skills import ...`
（skills.py 仅依赖标准库——已核实）。plan 的 planner 由桥接器（宿主）注入：
RV 语义为"AgentSkill 是规划侧契约，执行由宿主注入的 planner 承担"。
运行：python3 scripts/rv-bridge/rv_mcp_bridge.py [RV_REPO_ROOT]
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

RV_ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "projects" / "rv").resolve()
sys.path.insert(0, str(RV_ROOT))

from harness.skills import SkillManifest, SkillRegistry  # noqa: E402


class EchoPlanner:
    """宿主注入的 stub planner（RV plan 契约的第一个参数）。"""

    async def complete(self, instructions: str, context: Any = None) -> str:
        return instructions


class WordCountSkill:
    """演示能力：实现 RV AgentSkill 协议（规划侧），纯只读。"""

    name = "wordcount"
    capabilities = frozenset({"wordcount"})
    manifest = SkillManifest(
        name="wordcount",
        version="1.0.0",
        description="统计给定文本的词数与字符数。Use when: 用户要求统计词数/字数。",
        capabilities=frozenset({"wordcount"}),
        planner_instructions="把 text 参数原样交给计数逻辑，不要改写。",
        routing_schema={
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
            "additionalProperties": False,
        },
    )
    routing_schema = manifest.routing_schema

    async def plan(self, planner: Any, arguments: dict[str, Any], **_: Any) -> dict[str, Any]:
        text = str(arguments.get("text", ""))
        return {
            "words": len(text.split()),
            "chars": len(text),
            "planner_saw": str(getattr(planner, "marker", "none")),
        }


def build_registry() -> SkillRegistry:
    registry = SkillRegistry()
    registry.register(WordCountSkill())
    return registry


REGISTRY = build_registry()
PLANNER = EchoPlanner()
PLANNER.marker = "rv-bridge-host"


def tools_list() -> dict[str, Any]:
    """routing_contracts → ms 的 McpToolDeclaration（名称/说明/入参模式+披露）。"""
    tools = []
    for contract in REGISTRY.routing_contracts:
        tools.append({
            "name": str(contract["name"]),
            "description": str(contract["description"]),
            "inputSchema": contract["arguments_schema"],
            "readOnly": True,
            "networkAccess": "none",
        })
    return {"tools": tools}


def tools_call(params: dict[str, Any]) -> dict[str, Any]:
    capability = str(params.get("name", ""))
    skill = REGISTRY.for_capability(capability)
    if skill is None:
        return {"isError": True, "message": f"RV 未知能力: {capability}"}
    arguments = params.get("arguments") or {}
    result = asyncio.run(skill.plan(PLANNER, dict(arguments)))
    return {"ok": True, "capability": capability, "result": result}


def main() -> None:
    print(f"[rv-bridge] rv_root={RV_ROOT} capabilities={REGISTRY.capabilities}", file=sys.stderr)
    buffer = ""
    while True:
        line = sys.stdin.readline()
        if line == "":
            break
        stripped = line.strip()
        if stripped == "":
            continue
        message_id: Any = None
        try:
            message = json.loads(stripped)
            message_id = message.get("id")
            method = message.get("method")
            if method == "tools/list":
                reply = tools_list()
            elif method == "tools/call":
                reply = tools_call(message.get("params") or {})
            elif method == "cancel":
                continue  # 演示能力同步快速完成，无需取消
            else:
                reply = {"error": {"message": f"unknown method {method}"}}
            sys.stdout.write(json.dumps({"id": message_id, "result": reply}) + "\n")
            sys.stdout.flush()
        except Exception as error:  # noqa: BLE001
            sys.stdout.write(json.dumps({
                "id": message_id,
                "error": {"message": str(error)},
            }) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
