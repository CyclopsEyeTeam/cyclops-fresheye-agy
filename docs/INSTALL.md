# Installing Cyclops FreshEye for Antigravity (`agy`)

## Requirements
- Antigravity CLI (`agy` v1.2.1+ / v1.4.x)
- Node.js 18+

## One-Step Install

```bash
git clone https://github.com/CyclopsEyeTeam/cyclops-fresheye-agy.git
cd cyclops-fresheye-agy
./installer.sh
```

What `./installer.sh` configures:
1. Validates the plugin with `agy plugin validate --strict`.
2. Installs the plugin bundle into `~/.gemini/config/plugins/cyclops-fresheye`.
3. Symlinks `agy-fresheye`, `fresheye`, and `fresheye-ctl` into `~/.local/bin`.
4. Configures `statusLine` in `~/.gemini/antigravity-cli/settings.json` with `"stack_with_default": true` so `agy`'s built-in statusline remains visible and the `◎ FreshEye` strip appears only when in a FreshEye session (or for 8s after returning).
5. Adds the `agy --fresheye` and `agy --fresheye-log` shell wrapper to `~/.bashrc` (preserving `cyclops-prism` `agy --prism` flags).

## Uninstalling

```bash
./uninstaller.sh          # keeps ~/.local/state/cyclops-fresheye/store.json
./uninstaller.sh --purge  # also deletes saved pairs and ledger
```
