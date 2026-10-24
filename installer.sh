#!/usr/bin/env bash
# Cyclops FreshEye installer for Antigravity (agy)
set -euo pipefail

PLUGIN_NAME="cyclops-fresheye"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${HOME}/.local/bin"
PLUGINS_DIR="${HOME}/.gemini/config/plugins"
TARGET_PLUGIN_DIR="${PLUGINS_DIR}/${PLUGIN_NAME}"
CLI_SETTINGS="${HOME}/.gemini/antigravity-cli/settings.json"
DRY_RUN=0

usage() {
  cat <<'EOF'
Cyclops FreshEye Installer (Antigravity / agy)

Usage:
  ./installer.sh [options]

Options:
  --dry-run       Show what would be installed without modifying files
  --uninstall     Uninstall Cyclops FreshEye
  -h, --help      Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --uninstall)
      exec "${SCRIPT_DIR}/uninstaller.sh"
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

echo "=========================================="
echo "  Cyclops FreshEye Installer (agy v0.2.2) "
echo "=========================================="
echo "Source:  ${SCRIPT_DIR}"
echo "Target:  ${TARGET_PLUGIN_DIR}"
echo "Binaries: ${BIN_DIR}/{agy-fresheye,fresheye,fresheye-ctl}"

if [[ ! -f "${SCRIPT_DIR}/plugin.json" ]] || [[ ! -f "${SCRIPT_DIR}/scripts/core.js" ]]; then
  echo "Error: plugin files not found in ${SCRIPT_DIR}" >&2
  exit 1
fi

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo ""
  echo "[dry-run] Would validate plugin with: agy plugin validate \"${SCRIPT_DIR}\" --strict"
  echo "[dry-run] Would install plugin to: ${TARGET_PLUGIN_DIR}"
  echo "[dry-run] Would symlink CLI launchers in: ${BIN_DIR}"
  echo "[dry-run] Would configure stacked statusLine in: ${CLI_SETTINGS}"
  echo "[dry-run] Would add 'agy --fresheye' helper block to: ${HOME}/.bashrc"
  exit 0
fi

chmod +x "${SCRIPT_DIR}/scripts/"*.js "${SCRIPT_DIR}/bin/"*

# 1. Validate plugin structure if agy is available
if command -v agy >/dev/null 2>&1; then
  echo "Validating plugin structure..."
  agy plugin validate "${SCRIPT_DIR}" --strict >/dev/null
  echo "✓ Plugin validation passed (--strict)."
fi

# 2. Install plugin into ~/.gemini/config/plugins/cyclops-fresheye
mkdir -p "${PLUGINS_DIR}"
SOURCE_REAL="$(cd -P "${SCRIPT_DIR}" && pwd)"
TARGET_REAL="$(mkdir -p "${TARGET_PLUGIN_DIR}" && cd -P "${TARGET_PLUGIN_DIR}" && pwd)"

if [[ "${SOURCE_REAL}" != "${TARGET_REAL}" ]]; then
  if command -v agy >/dev/null 2>&1; then
    agy plugin uninstall "${PLUGIN_NAME}" >/dev/null 2>&1 || true
  fi
  rm -rf "${TARGET_PLUGIN_DIR}"
  mkdir -p "${TARGET_PLUGIN_DIR}"
  for item in plugin.json package.json hooks.json README.md CHANGELOG.md LICENSE installer.sh uninstaller.sh agents assets bin docs rules scripts skills; do
    if [[ -e "${SCRIPT_DIR}/${item}" ]]; then
      cp -R "${SCRIPT_DIR}/${item}" "${TARGET_PLUGIN_DIR}/"
    fi
  done
fi
chmod +x "${TARGET_PLUGIN_DIR}/scripts/"*.js "${TARGET_PLUGIN_DIR}/bin/"*

if command -v agy >/dev/null 2>&1; then
  agy plugin enable "${PLUGIN_NAME}" >/dev/null 2>&1 || true
fi
echo "✓ Installed plugin to ${TARGET_PLUGIN_DIR}"

# 3. Symlink CLI launchers into ~/.local/bin
mkdir -p "${BIN_DIR}"
ln -sf "${TARGET_PLUGIN_DIR}/bin/agy-fresheye" "${BIN_DIR}/agy-fresheye"
ln -sf "${TARGET_PLUGIN_DIR}/bin/agy-fresheye" "${BIN_DIR}/fresheye"
ln -sf "${TARGET_PLUGIN_DIR}/bin/fresheye-ctl" "${BIN_DIR}/fresheye-ctl"
echo "✓ Installed CLI launchers: agy-fresheye, fresheye, fresheye-ctl"

# 4. Configure stacked statusLine in ~/.gemini/antigravity-cli/settings.json
mkdir -p "$(dirname "${CLI_SETTINGS}")"
node - "${CLI_SETTINGS}" "${TARGET_PLUGIN_DIR}/scripts/statusline.js" <<'EOF'
const fs = require('node:fs');
const [settingsPath, statuslineScript] = process.argv.slice(2);
try {
  let data = {};
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    if (raw.trim()) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data = parsed;
      }
    }
  }
  const quotedScript = /\s/.test(statuslineScript) ? JSON.stringify(statuslineScript) : statuslineScript;
  const cmd = `node ${quotedScript}`;
  if (data.statusLine && data.statusLine.command && !String(data.statusLine.command).includes('cyclops-fresheye')) {
    data._fresheyePreviousStatusLine = data.statusLine;
  }
  data.statusLine = {
    enabled: true,
    stack_with_default: true,
    command: cmd,
  };
  const tmp = `${settingsPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, settingsPath);
  console.log('✓ Configured stacked FreshEye statusline in ~/.gemini/antigravity-cli/settings.json');
} catch (err) {
  console.error('Notice: Could not update settings.json statusLine automatically:', err.message);
}
EOF

# 5. Add shell wrapper in ~/.bashrc (coexisting with cyclops-prism)
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
  cat << 'EOF' >> "${HOME}/.bashrc"

# >>> Cyclops FreshEye launcher >>>
agy() {
    local use_fresheye=0
    local use_prism=0
    for arg in "$@"; do
        case "$arg" in
            --fresheye|--cyclops-fresheye|--fresheye-log)
                use_fresheye=1
                break
                ;;
            --prism|--cyclops-prism|--prismtop|--cyclops-prismtop|--prism-side|--prism-top|--cyclops-prism-side|--cyclops-prism-top)
                use_prism=1
                ;;
        esac
    done
    if [ "$use_fresheye" -eq 1 ]; then
        agy-fresheye "$@"
    elif [ "$use_prism" -eq 1 ] && command -v agy-prism >/dev/null 2>&1; then
        agy-prism "$@"
    else
        command agy "$@"
    fi
}
# <<< Cyclops FreshEye launcher <<<
EOF
  echo "✓ Configured 'agy --fresheye' & 'agy --fresheye-log' in ~/.bashrc"
fi

echo ""
echo "=========================================="
echo "✓ Cyclops FreshEye installed successfully!"
echo "=========================================="
echo ""
echo "1. In-Chat (Subagent & Pairing Skills inside agy):"
echo "   /fresheye \"Review src/parser.ts and list edge cases the tests miss\""
echo "   /fresheye              (inspect paired session & /resume command)"
echo "   /fresheye-log [count]  (view session & switch audit ledger)"
echo ""
echo "2. Standalone Interactive Session & Switcher (Terminal):"
echo "   agy --fresheye \"Review src/parser.ts...\"   (or: agy-fresheye \"...\")"
echo "   agy --fresheye                             (switch between original & FreshEye)"
echo "   agy --fresheye-log [count]                 (or: fresheye-ctl log)"
echo ""
echo "Note: Restart any running 'agy' session so it discovers the new plugin."
