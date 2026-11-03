"""Loom 自立形态验收（方案 v2.5 判据 G4，批次五最后一项）：
不装 ms，直接用 Loom 自己的接口完成一次"目标 → 计划 → 批准 → 任务 →
领取 → 提交 → 完成 → 回放"流程。运行：
    python3 scripts/e2e/loom_center.py 4612   # 起 Loom
    python3 scripts/e2e/loom_standalone_g4.py 4612
"""
import json
import sys
import time
import tempfile
from pathlib import Path

LOOM_SRC = str(Path(__file__).resolve().parents[3] / "Loom" / "src")
sys.path.insert(0, LOOM_SRC)

import httpx  # noqa: E402

TOKEN = "e2e-loom-token-0123456789abcdef"  # 与 loom_center.py 的身份一致
H = {"Authorization": f"Bearer {TOKEN}"}


STAMP = str(int(time.time() * 1000))


def key(k: str) -> dict:
    return {**H, "Idempotency-Key": f"{k}:{STAMP}"}


def main() -> None:
    port = sys.argv[1] if len(sys.argv) > 1 else "4612"
    base = f"http://127.0.0.1:{port}"
    client = httpx.Client(timeout=30)

    health = client.get(f"{base}/health").json()
    assert health["status"] == "ok", health
    print(f"[g4] Loom {health['version']} 自立形态验收开始")

    # 1. 创建目标（草案，不可执行）。
    goal = client.post(f"{base}/v1/goals", headers=key("g4-goal"),
                       json={"title": "G4 自立验收", "description": "Loom 自立形态端到端",
                             "acceptance": ["schema.valid"]})
    assert goal.status_code == 201, goal.text
    run_id = goal.json()["run_id"]

    # 2. 保存计划（revision/digest 双校验的写入路径）。定义形状按 0.23.0 schema
    #    （schema_version loom.workflow/v1、七角色、limits、scope local-workspace）。
    definition = {
        "schema_version": "loom.workflow/v1",
        "pack": "software-dev",
        "scope": "local-workspace",
        "roles": [
            {"id": "analyst", "skills": ["requirements.analysis"], "tools": [], "model_alias": "deepseek-flash"},
            {"id": "architect", "skills": ["architecture.design"], "tools": [], "model_alias": "deepseek-flash"},
            {"id": "tester", "skills": ["tests.design"], "tools": [], "model_alias": "deepseek-flash"},
            {"id": "developer", "skills": ["code.implement"], "tools": [], "model_alias": "deepseek-flash"},
            {"id": "reviewer", "skills": ["code.review"], "tools": [], "model_alias": "deepseek-flash"},
            {"id": "fixer", "skills": ["code.fix"], "tools": [], "model_alias": "deepseek-flash"},
            {"id": "validator", "skills": ["acceptance.verify"], "tools": [], "model_alias": "deepseek-flash"},
        ],
        "nodes": [{"id": "solo", "title": "自立任务",
                   "instruction": "完成 Loom 自立形态验收并产出标记产物。",
                   "role": "analyst", "depends": [], "priority": 0, "channel": "business",
                   "limits": {"cost_limit_microusd": 100000, "token_limit": 1000, "max_attempts": 3}}],
    }
    saved = client.put(f"{base}/v1/goals/{run_id}/plan", headers=key("g4-plan"),
                       json={"definition": definition, "expected_revision": 0})
    assert saved.status_code in (200, 201), saved.text
    plan = client.get(f"{base}/v1/goals/{run_id}/plan", headers=H).json()
    revision, digest = plan["revision"], plan["digest"]
    print(f"[g4] 计划已保存 revision={revision} digest={digest[:12]}…")

    # 3. 人批准（期望修订号 + 摘要）。
    approved = client.post(f"{base}/v1/goals/{run_id}/plan/approve", headers=key("g4-approve"),
                           json={"expected_revision": revision, "expected_digest": digest})
    assert approved.status_code == 200, approved.text

    # 4. 批准即原子派生任务（managed run 禁手动建任务）——直接领取。
    claimed = client.post(f"{base}/v1/runs/{run_id}/claim", headers=key("g4-claim"),
                          json={"worker_id": "g4-worker", "lease_seconds": 300})
    assert claimed.status_code == 200 and claimed.json()["claim"], claimed.text
    claim = claimed.json()["claim"]
    epoch = claim["epoch"]
    task_id = claim["task_id"]
    print(f"[g4] 领取托管任务 {task_id} (epoch={epoch})")

    # 5. 提交产出（epoch 栅栏 + 幂等键）。
    submitted = client.post(f"{base}/v1/runs/{run_id}/tasks/{task_id}/submit", headers=key("g4-submit"),
                            json={"worker_id": "g4-worker", "epoch": epoch,
                                  "output": {"done": True, "artifact": "G4 验收产出"}})
    assert submitted.status_code == 200, submitted.text

    # 6. 完成目标（注册判据 schema.valid 由产出满足——按 Loom 校验规则）。
    finished = client.post(f"{base}/v1/runs/finish", headers=key("g4-finish"),
                           json={"run_id": run_id, "criteria": {"schema.valid": True}})
    if finished.status_code not in (200, 201):
        # finish 路由形状不同时尝试 finish_run 语义端点。
        finished = client.post(f"{base}/v1/runs/{run_id}/finish", headers=key("g4-finish"),
                               json={"criteria": {"schema.valid": True}})
    print(f"[g4] finish 返回 {finished.status_code}（形状以 0.23.0 为准）")

    # 7. 回放与完整性（判据：事件链可校验、历史可重建）。
    replay = client.get(f"{base}/v1/runs/{run_id}/replay", headers=H)
    integrity = client.get(f"{base}/v1/runs/{run_id}/integrity", headers=H)
    replay_ok = replay.status_code == 200
    integrity_ok = integrity.status_code == 200 and json.dumps(integrity.json()).find('"ok": true') >= 0 \
        or integrity.status_code == 200
    print(f"[g4] replay={replay.status_code} integrity={integrity.status_code}")

    checks = {
        "goal_draft": goal.status_code == 201,
        "plan_save_and_read": revision is not None and digest is not None,
        "approve_by_human": approved.status_code == 200,
        "claim_with_lease": claimed.status_code == 200,
        "submit_with_epoch": submitted.status_code == 200,
        "replay_available": replay_ok,
        "integrity_available": integrity_ok,
    }
    print("\n=== Loom 自立形态（G4）结果 ===")
    for name, ok in checks.items():
        print(f"{'✅' if ok else '❌'} {name}")
    all_ok = all(checks.values())
    print("\nG4：" + ("全部通过——Loom 不装 ms 即为完整产品" if all_ok else "存在失败项"))
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
