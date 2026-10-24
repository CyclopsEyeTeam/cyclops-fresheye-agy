# Changelog

## 0.2.2 (2026-10-24)

- **Browser & Full Toolset Support (`agents/fresheye.md`)**:
  - Enabled the full built-in toolset (`read_file`, `view_file`, `write_file`, `edit_file`, `run_command`, `manage_task`, `invoke_subagent`, `define_subagent`, `manage_subagents`, `search_web`, `read_url_content`, `generate_image`, `ask_question`, `list_plugin_accounts`, `notebook_edit`), `inheritMcp: true`, built-in subagents (`browser`, `research`, `self`, `image-generator`), and the `chrome_devtools` browser MCP server while keeping `inheritCustomizations: false`.
- **FreshEye Review Hardening**:
  - Added root `package.json` (`"type": "module"`) for Node 18/20+ ESM compatibility and zero CJS-to-ESM reparse overhead.
  - Replaced raw `file://${process.argv[1]}` entrypoint checks with `isCliEntrypoint` (`fs.realpathSync` + `pathToFileURL`) across `hook.js`, `fresheye-ctl.js`, and `statusline.js` to support symlinks and paths with spaces.
  - Reduced `PENDING_OPEN_TTL_MS` to 60s, enforced workspace matching on `pendingOpen` and `lastUnpairedStart`, and added `clear-pending` cleanup on interactive exit.
  - Extracted child subagent `conversationId` directly from `PostToolUse` `payload.result`, handled subagents completing before `PostToolUse`, and prevented non-FreshEye subagents (`research`, `browser`, `self`) from mis-pairing via `lastUnpairedStart`.
  - Handled stdin EOF (`close`) in `promptSwitchConfirm` so `Ctrl+D` / `/dev/null` cancels immediately (`exitCode = 5`) instead of waiting for the timeout.
  - Updated `detectRecentConversationId` to check `ANTIGRAVITY_CONVERSATION_ID`, `CYCLOPS_FRESHEYE_CONVERSATIONS_DIR`, and `antigravity-ide/conversations`, and removed the fake `'origin-session'` fallback.
  - Prevented `buildAgyStatusLine` from falling back to global `store.activeSession.id` when `statusData` has no `conversation_id`.
  - Fixed CLI flag parsing in `bin/agy-fresheye` (`--mode`, `-p`/`--print`, `--model`) and `scripts/fresheye-ctl.js` (`BOOLEAN_FLAGS`, `--` values, `log --json` clamping & ordering) and added `switch-failed` handling.
  - Fixed `appendLedger` to truncate in-place (`splice`) and hardened `installer.sh` / `uninstaller.sh` packaging and portability.

## 0.2.1 (2026-10-23)

- **Antigravity (`agy`) Hybrid Port (Option C)**:
  - Added native custom agent `agents/fresheye.md` with `inheritCustomizations: false`, `mainAgent: true`, `subagent: true`, and `model: inherit` to withhold `AGENTS.md`, `GEMINI.md`, rules, skills, and ambient plugin context on the same model.
  - Added in-chat skills `skills/fresheye/SKILL.md` (`/fresheye`) and `skills/fresheye-log/SKILL.md` (`/fresheye-log`).
  - Ported core pairing (`originFor`, `pickTarget`), store pruning (`MAX_PAIRS = 50`), and capped 1,000-entry audit ledger (`formatLedger`) in `scripts/core.js`.
  - Added synchronous lifecycle hook observer `scripts/hook.js` (`SessionStart`, `PreInvocation`, `PostToolUse`, `Stop`) to correlate subagent and standalone FreshEye sessions automatically.
  - Added stacked TUI statusline renderer `scripts/statusline.js` (`◎ FreshEye · Fresh Context` active strip + 8-second `✓ Original conversation restored` notice).
  - Added standalone interactive launcher & session switcher `bin/agy-fresheye` (`agy --fresheye`, `agy --fresheye-log`) and `bin/fresheye-ctl` with `ask` (default, `Stay here` focused, 60s timeout), `toggle`, and `off` switch modes.
