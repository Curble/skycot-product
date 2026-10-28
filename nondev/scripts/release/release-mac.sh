#!/bin/sh
# Mac beta release in the safe order. See release-mac.mjs and RUNBOOK "NEVER BREAK IN-APP UPDATE".
#   nondev/scripts/release/release-mac.sh --version 0.1.1-nondev.37.beta --previous 0.1.1-nondev.36.beta [--dry-run] [--skip-build]
export PATH="$HOME/.local/share/vite-plus/js_runtime/node/24.22.0/bin:$PATH"
. /Users/me/.config/vite-plus/env 2>/dev/null
unset CARGO_TARGET_DIR
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
exec node "$(dirname "$0")/release-mac.mjs" "$@"
