# Testing Cyclops FreshEye (`agy`)

## Automated Tests

Run the unit and integration test suite (zero external dependencies):

```bash
node --test tests/*.test.js
```

Run strict Antigravity plugin validation:

```bash
agy plugin validate . --strict --json
```

## Manual Verification Checklist

1. **In-Chat Subagent Review**:
   - Start `agy` and run `/fresheye Review plugin.json and scripts/core.js for edge cases`.
   - Confirm it delegates to the isolated `fresheye` subagent (`Model: "inherit"`, `inheritCustomizations: false`) and logs `open` + `return` in `/fresheye-log`.
2. **Standalone FreshEye Session**:
   - Run `agy --fresheye "Audit scripts/hook.js for failure modes"`.
   - Confirm the stacked statusline shows `◎ FreshEye · Fresh Context (<freshId>) · opened HH:MM · original <originId> kept`.
3. **Session Switching**:
   - Run `agy --fresheye` (bare) and verify the confirmation prompt defaults to `[1] Stay here (default)` with a 60-second timeout, and selecting `[2]` resumes the paired conversation.
