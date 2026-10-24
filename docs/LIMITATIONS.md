# Limitations & Honest Boundaries

1. **What `inheritCustomizations: false` Withholds vs. Preserves**:
   - In Antigravity (`agy`), `agents/fresheye.md` sets `inheritCustomizations: false`. This natively withholds user and workspace `AGENTS.md`, `GEMINI.md`, `.agents/rules/`, and ambient skills from the FreshEye trajectory while preserving the active model (`model: inherit`) and workspace file access.
   - Because omitting `tools:` in an Antigravity custom agent defaults to a 6-tool read-only subset, `agents/fresheye.md` explicitly enables the full built-in toolset (`read_file`, `view_file`, `write_file`, `edit_file`, `run_command`, `manage_task`, `invoke_subagent`, `define_subagent`, `manage_subagents`, `search_web`, `read_url_content`, etc.), `inheritMcp: true`, built-in subagents (`browser`, `research`, `self`, `image-generator`), and the `chrome_devtools` browser MCP server so FreshEye has full browser and command capabilities in both standalone (`agy --fresheye`) and subagent (`/fresheye <prompt>`) modes.
2. **Workspace Files on Disk**:
   - FreshEye runs in the same workspace directory so it can read the files you ask it to review. While `agents/fresheye.md` instructs the model not to read `AGENTS.md` or `GEMINI.md` unless explicitly asked, those files still exist on disk.
3. **In-TUI Conversation Switching**:
   - Inside an already-running `agy` TUI, slash skills cannot force the Bubble Tea UI to hot-swap the top-level `conversationId` without user action; in-chat `/fresheye <prompt>` runs via an isolated `fresheye` subagent trajectory (returning the fresh review directly in chat), and full-session switching uses `/resume <targetId>` inside the TUI or `agy --fresheye` / `agy-fresheye` from the terminal.
