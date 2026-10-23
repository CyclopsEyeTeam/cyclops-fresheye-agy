# Cyclops FreshEye for Antigravity (`agy`)

**Same AI, fresh perspective.**

Give your AI a fresh pair of eyes without losing your place.

During a long coding session, your builder conversation gets attached to its own plan: it has read the conversation history, followed your `AGENTS.md` / `GEMINI.md` rules, and absorbed ambient customizations. When you ask *"is this actually right?"*, it is already primed to agree with itself.

**Cyclops FreshEye** opens a clean, unprimed perspective on the **same model** — withholding `AGENTS.md`, `GEMINI.md`, rules, skills, and prior conversation history (`inheritCustomizations: false`) — while keeping your original conversation untouched and paired.

---

## Hybrid Architecture (Option C: In-Chat Subagent + Standalone Session Switcher)

Cyclops FreshEye for Antigravity (`agy`) gives you **both** ways to work:

### 1. In-Chat Isolated Subagent (`/fresheye "prompt"`)
Stay inside your active `agy` conversation and run:
```text
/fresheye Review src/parser.ts and tests/parser.test.ts. List edge cases the tests miss.
```
- Spawns the `fresheye` custom agent (`inheritCustomizations: false`, `Model: "inherit"`) in its own isolated trajectory (`conversation://<freshId>`).
- Automatically pairs `originId <-> freshId` via `hooks.json` and logs `open` + `return` to the audit ledger.
- Returns the unprimed review directly into your chat, while keeping the full FreshEye conversation resumable via `/resume <freshId>` or `agy-fresheye`.

### 2. Full Interactive Standalone Session & Switcher (`agy --fresheye` / `agy-fresheye`)
Open or toggle a full interactive FreshEye session from your terminal:
```bash
# Open a fresh-context interactive session on the same model:
agy --fresheye "Audit src/auth.ts for token validation assumptions"

# Switch back and forth between original and paired FreshEye session:
agy --fresheye

# View the session & switch history ledger:
agy --fresheye-log 20
```
- While inside a FreshEye session, `agy`'s native stacked statusline displays:
  ```text
  ◎ FreshEye · Fresh Context (3c82a10d) · opened 17:30 · original 4ee9d53c kept · /resume 4ee9d53c to return
  ```
- When you return to your original conversation, the statusline confirms for 8 seconds:
  ```text
  ✓ Original conversation 4ee9d53c restored · FreshEye 3c82a10d kept
  ```

---

## Commands & Reference

| Command | Where | Description |
| :--- | :--- | :--- |
| `/fresheye <prompt>` | Inside `agy` | Runs `<prompt>` in an isolated `fresheye` subagent (`inheritCustomizations: false`, same model) and pairs `originId <-> freshId`. |
| `/fresheye` | Inside `agy` | Shows the active conversation's paired session (`return` to original or `enter` newest FreshEye) and `/resume <id>` command. |
| `/fresheye-log [count]` | Inside `agy` | Displays the append-only FreshEye session & switch ledger (default 20 entries). |
| `agy --fresheye "<prompt>"` | Terminal | Opens a full interactive `agy --agent fresheye -i "<prompt>"` session paired to your current conversation. |
| `agy --fresheye` | Terminal | Switches between your original conversation and its paired FreshEye session (`ask`, `toggle`, or `off`). |
| `agy --fresheye-log [count]` | Terminal | Prints the FreshEye ledger directly in the terminal. |

---

## Install & Uninstall

```bash
git clone https://github.com/CyclopsEyeTeam/cyclops-fresheye-agy.git
cd cyclops-fresheye-agy

# Install plugin, CLI launchers, bashrc helper, and stacked statusline:
./installer.sh

# Uninstall (keeps saved pairs & ledger in ~/.local/state/cyclops-fresheye):
./uninstaller.sh

# Uninstall and delete saved pairs & ledger:
./uninstaller.sh --purge
```

See [docs/INSTALL.md](./docs/INSTALL.md), [docs/LIMITATIONS.md](./docs/LIMITATIONS.md), and [docs/TESTING.md](./docs/TESTING.md) for details.
