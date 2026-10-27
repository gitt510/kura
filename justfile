set shell := ["bash", "-cu"]

repo := justfile_directory()

biome := "bunx @biomejs/biome@2.5.15"

# List available recipes.
_default:
    @just --list --unsorted

# Set up local entrypoints without enabling recording or extensions.
[group('setup')]
setup:
    @bun install --frozen-lockfile --cwd "{{repo}}"
    @bun "{{repo}}/src/cli.ts" setup

# Create config.json with every key at its default. Never overwrites.
[group('setup')]
init-config:
    @bun "{{repo}}/src/cli.ts" init-config

# Start recording an agent's conversations (claude, codex, or all).
[group('setup')]
enable agent:
    @bun "{{repo}}/src/cli.ts" enable "{{agent}}"

# Stop recording an agent's conversations (claude, codex, or all).
[group('setup')]
disable agent:
    @bun "{{repo}}/src/cli.ts" disable "{{agent}}"

# Enable or disable scheduled generation for an extension.
[group('extensions')]
schedule action extension:
    @bun "{{repo}}/src/cli.ts" extension schedule "{{action}}" "{{extension}}"

# Disable recording and extensions, then remove local entrypoints.
[group('setup')]
teardown:
    @bun "{{repo}}/src/cli.ts" teardown

# Show setup and extension state.
[group('operations')]
status:
    @bun "{{repo}}/src/cli.ts" status

# Browse kura.db in Datasette (read-only).
[group('operations')]
view-db:
    #!/usr/bin/env bash
    set -euo pipefail
    command -v uvx >/dev/null || { echo "error: uvx not found — install uv: https://docs.astral.sh/uv/"; exit 1; }
    db="${XDG_STATE_HOME:-$HOME/.local/state}/kura/kura.db"
    [[ -f "$db" ]] || { echo "error: $db not found"; exit 1; }
    exec uvx datasette --open "$db"

# Show LLM token usage and cost per extension.
[group('operations')]
usage *args:
    @bun "{{repo}}/src/cli.ts" usage {{args}}

# Check formatting, import order, and lint rules with Biome (read-only).
[group('development')]
check:
    @{{biome}} check "{{repo}}"

# Apply Biome formatting and safe lint fixes.
[group('development')]
fmt:
    @{{biome}} check --write "{{repo}}"

# Run the Bun test suite. For a subset, run bun test <path>.
[group('development')]
test:
    @bun test ./src ./tests
