---
name: fresheye-log
description: >-
  Show the Cyclops FreshEye session & switch history ledger (local timestamps,
  open/return/enter/stale events, paired session IDs, model, and prompt topic preview).
  Supports `/fresheye-log [count]`.
---

# /fresheye-log — FreshEye Session & Switch Ledger

Display the append-only Cyclops FreshEye audit ledger (`open`, `open-failed`, `return`, `enter`, `stale`, `switch-failed`, `confirm-cancelled`, `confirm-timeout`, `interrupted`).

## Instructions

1. Run `fresheye-ctl log $ARGUMENTS` (or `node ~/.gemini/config/plugins/cyclops-fresheye/scripts/fresheye-ctl.js log $ARGUMENTS`) using `run_command`.
2. Output the formatted ledger table verbatim inside a code block without extra commentary.
