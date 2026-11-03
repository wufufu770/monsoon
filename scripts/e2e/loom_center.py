"""e2e Loom 中心：打了解决方案 v2.5 步骤三 patch 的工作副本起服务。

用途：ms↔Loom 全链路联调（步骤 D）。以 legacy 租户键提供 developer 身份
（含 task.claim），监听 127.0.0.1:4610。临时库，进程退出即弃。
"""
import sys
import tempfile
from pathlib import Path

LOOM_SRC = str(Path(__file__).resolve().parents[3] / "Loom" / "src")
sys.path.insert(0, LOOM_SRC)

import uvicorn  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from loom.api import create_app  # noqa: E402
from loom.store import Store  # noqa: E402

TOKEN = "e2e-loom-token-0123456789abcdef"

def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4610
    tmp = tempfile.TemporaryDirectory()
    store = Store(Path(tmp.name) / "e2e.db")
    app = create_app(store, {"tenant-a": TOKEN})
    print(f"[loom-center] ready on 127.0.0.1:{port} token={TOKEN}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

if __name__ == "__main__":
    main()
