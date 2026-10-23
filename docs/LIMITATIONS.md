# Limitations & Honest Boundaries

1. **What `inheritCustomizations: false` Withholds**:
   - In Antigravity (`agy`), `agents/fresheye.md` sets `inheritCustomizations: false`. This natively withholds user and workspace `AGENTS.md`, `GEMINI.md`, `.agents/rules/`, skills, plugins, and MCP servers from the FreshEye trajectory while preserving the active model (`model: inherit`) and workspace file access.
   - Built-in core tools (`read_file`, `run_command`, etc.) and Antigravity's base system instructions remain active so FreshEye can inspect the codebase normally.
2. **Workspace Files on Disk**:
   - FreshEye runs in the same workspace directory so it can read the files you ask it to review. While `agents/fresheye.md` instructs the model not to read `AGENTS.md` or `GEMINI.md` unless explicitly asked, those files still exist on disk.
3. **In-TUI Conversation Switching**:
   - Inside an already-running `agy` TUI, slash skills cannot force the Bubble Tea UI to hot-swap the top-level `conversationId` without user action; in-chat `/fresheye <prompt>` runs via an isolated `fresheye` subagent trajectory (returning the fresh review directly in chat), and full-session switching uses `/resume <targetId>` inside the TUI or `agy --fresheye` / `agy-fresheye` from the terminal.
