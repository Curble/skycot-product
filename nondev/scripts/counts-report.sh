#!/bin/sh
set -eu
export PATH="$HOME/.local/share/vite-plus/js_runtime/node/24.22.0/bin:$PATH"
if [ -r "$HOME/.config/vite-plus/env" ]; then
  . "$HOME/.config/vite-plus/env"
fi
unset CARGO_TARGET_DIR
exec node "$(dirname "$0")/counts-report.ts" "$@"
