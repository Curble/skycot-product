#!/bin/sh
set -eu
PATH="$HOME/.local/share/vite-plus/js_runtime/node/24.22.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH
. /Users/me/.config/vite-plus/env
unset CARGO_TARGET_DIR
cd /Users/me/skycot-wt-smoother
exec node nondev/scripts/upstream-trial.ts "$@"
