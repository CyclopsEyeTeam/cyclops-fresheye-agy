---
name: fresheye
description: >-
  Open a fresh-context FreshEye review on the same model (with AGENTS.md, GEMINI.md,
  rules, and builder conversation history withheld) or inspect/switch between a paired
  FreshEye session and your original conversation. Supports `/fresheye "prompt"` and bare `/fresheye`.
---

# /fresheye — Same AI, Fresh Perspective

Open an unprimed **FreshEye** perspective (`◎ FreshEye · Fresh Context`) on the same model without your current conversation history, `AGENTS.md`, `GEMINI.md`, or ambient rules, while keeping your original conversation untouched.

## How to Handle `/fresheye`

Check whether the user provided a prompt after `/fresheye`:

### Case 1: `/fresheye <prompt>` (Prompt Provided)
1. **Do NOT answer `<prompt>` yourself** using the current conversation's context, memory, or rules.
2. Immediately delegate `<prompt>` to the isolated FreshEye agent using `invoke_subagent`:
   - `TypeName`: `"fresheye"`
   - `Role`: `"FreshEye · Fresh Context"`
   - `Model`: `"inherit"`
   - `Prompt`: Pass the user's exact `<prompt>` verbatim without adding your own summary, framing, or builder rationale (so FreshEye remains completely unprimed).
3. When the FreshEye subagent completes and returns its response:
   - Present the FreshEye findings clearly to the user under the header:
     `◎ FreshEye · Fresh Context (subagent: <freshIdShort> · original kept)`
   - Mention that the full isolated FreshEye conversation (`<freshId>`) is paired and can be resumed interactively anytime via `agy --fresheye` (or `agy --agent fresheye --conversation <freshId>`) and inspected in `/fresheye-log`.

### Case 2: Bare `/fresheye` (No Prompt)
1. Run `fresheye-ctl status` (or `node ~/.gemini/config/plugins/cyclops-fresheye/scripts/fresheye-ctl.js status`) via `run_command` to inspect the active conversation's pairing (`pickTarget`).
2. Present the pairing status clearly:
   - If a paired session exists (`return` to original `<originId>` or `enter` newest child FreshEye `<freshId>`), display:
     - The pair direction (`return` vs `enter`), short IDs, model, and opened timestamp
     - The command to switch interactively: `agy --fresheye` or `agy --conversation <targetId>` (or `/resume` in TUI)
   - If no paired FreshEye session exists for this conversation, report:
     `No paired FreshEye session for this conversation. Use: /fresheye "your prompt" (or agy --fresheye "your prompt")`
