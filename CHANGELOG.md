# Changelog

## 0.2.1 (2026-10-23)

- **Antigravity (`agy`) Hybrid Port (Option C)**:
  - Added native custom agent `agents/fresheye.md` with `inheritCustomizations: false`, `mainAgent: true`, `subagent: true`, and `model: inherit` to withhold `AGENTS.md`, `GEMINI.md`, rules, skills, and ambient plugin context on the same model.
  - Added in-chat skills `skills/fresheye/SKILL.md` (`/fresheye`) and `skills/fresheye-log/SKILL.md` (`/fresheye-log`).
  - Ported core pairing (`originFor`, `pickTarget`), store pruning (`MAX_PAIRS = 50`), and capped 1,000-entry audit ledger (`formatLedger`) in `scripts/core.js`.
  - Added synchronous lifecycle hook observer `scripts/hook.js` (`SessionStart`, `PreInvocation`, `PostToolUse`, `Stop`) to correlate subagent and standalone FreshEye sessions automatically.
  - Added stacked TUI statusline renderer `scripts/statusline.js` (`◎ FreshEye · Fresh Context` active strip + 8-second `✓ Original conversation restored` notice).
  - Added standalone interactive launcher & session switcher `bin/agy-fresheye` (`agy --fresheye`, `agy --fresheye-log`) and `bin/fresheye-ctl` with `ask` (default, `Stay here` focused, 60s timeout), `toggle`, and `off` switch modes.
