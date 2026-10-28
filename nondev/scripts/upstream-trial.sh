#!/bin/sh
set -eu
PATH="$HOME/.local/share/vite-plus/js_runtime/node/24.22.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH
. $HOME/.config/vite-plus/env
unset CARGO_TARGET_DIR
cd $HOME/skycot-wt-smoother
exec node nondev/scripts/upstream-trial.ts "$@"
