# Engine-Aware Pair Screener Validation
**Date:** 2026-09-12  

## Gate Criteria
- Dynamic beats static in at least 2/3 sub-periods and overall.
- Dynamic max drawdown is not worse than static by more than 5pp.

## Current Status
- Walk-forward gate is **FAIL**.
- Keep `engine_settings.auto_rotation_enabled=false` in production.
- Use manual replace flow with IS/OOS metrics in admin.

## Notes
- Full parity replay for `pair-selection-engine-aware.ts` is pending.
