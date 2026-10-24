#!/usr/bin/env bash
# Cyclops FreshEye uninstaller for Antigravity (agy)
set -euo pipefail

PLUGIN_NAME="cyclops-fresheye"
BIN_DIR="${HOME}/.local/bin"
PLUGINS_DIR="${HOME}/.gemini/config/plugins"
TARGET_PLUGIN_DIR="${PLUGINS_DIR}/${PLUGIN_NAME}"
CLI_SETTINGS="${HOME}/.gemini/antigravity-cli/settings.json"
STATE_DIR="${XDG_STATE_HOME:-${HOME}/.local/state}/cyclops-fresheye"
DRY_RUN=0
PURGE=0

usage() {
  cat <<'EOF'
Cyclops FreshEye Uninstaller (Antigravity / agy)

Usage:
  ./uninstaller.sh [options]

Options:
  --purge         Also remove saved session pairs and ledger (~/.local/state/cyclops-fresheye)
  --dry-run       Show what would be removed without deleting files
  -h, --help      Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge)
      PURGE=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

echo "Cyclops FreshEye Uninstaller (agy)"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "[dry-run] Would remove plugin: ${TARGET_PLUGIN_DIR}"
  echo "[dry-run] Would remove CLI symlinks: ${BIN_DIR}/{agy-fresheye,fresheye,fresheye-ctl}"
  echo "[dry-run] Would restore statusLine in: ${CLI_SETTINGS}"
  echo "[dry-run] Would remove Cyclops FreshEye block from: ${HOME}/.bashrc"
  if [[ "${PURGE}" -eq 1 ]]; then
    echo "[dry-run] Would remove state directory: ${STATE_DIR}"
  else
    echo "[dry-run] Would keep state directory: ${STATE_DIR} (pass --purge to remove)"
  fi
  exit 0
fi

# 1. Remove CLI symlinks
rm -f "${BIN_DIR}/agy-fresheye" "${BIN_DIR}/fresheye" "${BIN_DIR}/fresheye-ctl"

# 2. Remove bashrc helper block
if [[ -f "${HOME}/.bashrc" ]]; then
  node - "${HOME}/.bashrc" <<'EOF'
const fs = require('node:fs');
const [bashrcPath] = process.argv.slice(2);
try {
  const raw = fs.readFileSync(bashrcPath, 'utf8');
  const cleaned = raw.replace(
    /\n?# >>> Cyclops FreshEye launcher >>>[\s\S]*?# <<< Cyclops FreshEye launcher <<<\n?/g,
    '\n',
  );
  if (cleaned !== raw) {
    fs.writeFileSync(bashrcPath, cleaned);
  }
} catch {}
EOF
fi

# 3. Restore statusLine in ~/.gemini/antigravity-cli/settings.json
if [[ -f "${CLI_SETTINGS}" ]]; then
  node - "${CLI_SETTINGS}" <<'EOF'
const fs = require('node:fs');
const [settingsPath] = process.argv.slice(2);
try {
  const raw = fs.readFileSync(settingsPath, 'utf8');
  const data = JSON.parse(raw);
  if (data.statusLine && String(data.statusLine.command || '').includes('cyclops-fresheye')) {
    if (data._fresheyePreviousStatusLine) {
      data.statusLine = data._fresheyePreviousStatusLine;
      delete data._fresheyePreviousStatusLine;
    } else {
      delete data.statusLine;
    }
    const tmp = `${settingsPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, settingsPath);
  }
} catch {}
EOF
fi

# 4. Uninstall plugin
if command -v agy >/dev/null 2>&1; then
  agy plugin uninstall "${PLUGIN_NAME}" >/dev/null 2>&1 || true
fi
rm -rf "${TARGET_PLUGIN_DIR}"

# 5. Optional state purge
if [[ "${PURGE}" -eq 1 ]]; then
  rm -rf "${STATE_DIR}"
  echo "✓ Removed state directory: ${STATE_DIR}"
else
  echo "  Kept session pairs & ledger in ${STATE_DIR} (pass --purge to delete)."
fi

echo "✓ Uninstalled Cyclops FreshEye."
