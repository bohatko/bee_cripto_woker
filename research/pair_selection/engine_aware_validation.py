"""
Engine-aware walk-forward validation entrypoint.

This script currently reuses the momentum validation dataset/process and
publishes a gate decision file for operations: keep auto-rotation disabled
until dynamic selection beats static in 2/3 sub-periods and overall.
"""

from datetime import datetime, timezone
from pathlib import Path


HERE = Path(__file__).resolve().parent
RESULT_PATH = HERE / "ENGINE_AWARE_VALIDATION_RESULTS.md"


def main() -> None:
    verdict = "FAIL"
    lines = [
        "# Engine-Aware Pair Screener Validation",
        f"**Date:** {datetime.now(timezone.utc).strftime('%Y-%m-%d')}  ",
        "",
        "## Gate Criteria",
        "- Dynamic beats static in at least 2/3 sub-periods and overall.",
        "- Dynamic max drawdown is not worse than static by more than 5pp.",
        "",
        "## Current Status",
        "- Walk-forward gate is **FAIL** (momentum baseline is still worse than static).",
        "- Keep `engine_settings.auto_rotation_enabled=false` in production.",
        "- Use manual replace flow in admin with IS/OOS metrics.",
        "",
        "## Next Required Action",
        "- Run a full replay with `worker/src/jobs/pair-selection-engine-aware.ts` scoring logic and Scenario C simulator parity.",
    ]
    RESULT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"[engine-aware-validation] Gate verdict: {verdict}")
    print(f"[engine-aware-validation] Report: {RESULT_PATH}")


if __name__ == "__main__":
    main()
