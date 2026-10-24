# Cyclops FreshEye Rules

When the user invokes `/fresheye` or `/fresheye-log`:

1. **`/fresheye <prompt>`**:
   - Never answer `<prompt>` from the current builder context or inject your own framing/summary.
   - Always invoke the isolated `fresheye` subagent with `Model="inherit"` and pass `<prompt>` verbatim so it evaluates the request in a fresh context (`inheritCustomizations: false`, withholding `AGENTS.md`, `GEMINI.md`, rules, and prior conversation history).
2. **Bare `/fresheye` (no prompt)**:
   - Run `fresheye-ctl status` (or `node ~/.gemini/config/plugins/cyclops-fresheye/scripts/fresheye-ctl.js status`) to look up the deterministic paired session (`pickTarget`) and show the paired conversation ID and `agy --fresheye` / `agy --conversation <targetId>` / `/resume` command. Never guess a target session when no pair exists.
3. **`/fresheye-log [count]`**:
   - Run `fresheye-ctl log [count]` (or `node ~/.gemini/config/plugins/cyclops-fresheye/scripts/fresheye-ctl.js log [count]`) and display the formatted ledger output directly.
