#!/usr/bin/env bash
# launchd's minimal environment を補い、`kura <feature>` を実行して出力を state log に集約する。
set -euo pipefail

: "${HOME:?HOME is required}"
[[ "$#" -eq 1 ]] || { echo "usage: run.sh <feature>" >&2; exit 2; }

name="$1"
repo="$HOME/.local/share/kura"
log_dir="${XDG_STATE_HOME:-$HOME/.local/state}/kura"
log="$log_dir/$name.log"

export PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$log_dir"
echo "── $(date '+%Y-%m-%d %H:%M:%S %Z') $name start ──" >>"$log"

# project-scope skills (.claude/skills / .agents/skills) を解決できるよう repo root で実行する。
cd "$repo"
exec bun "$repo/src/cli.ts" "$name" >>"$log" 2>&1
