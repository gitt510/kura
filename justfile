set shell := ["bash", "-cu"]

repo := justfile_directory()

# Canonical GitHub repo for the maintainer-only apply-github-* recipes. Forks: change this.
github_repo := "gitt510/kura"

biome := "bunx @biomejs/biome@2.5.15"

# List available recipes.
_default:
    @just --list --unsorted

# Set up local entrypoints without enabling history sources or features.
[group('setup')]
setup:
    @bun install --frozen-lockfile --cwd "{{repo}}"
    @bun "{{repo}}/src/cli.ts" setup

# Create config.json with every key at its default. Never overwrites.
[group('setup')]
init-config:
    @bun "{{repo}}/src/cli.ts" init-config

# Resolve the op:// webhook references in config.json into the state dir. Requires 'op signin'.
[group('setup')]
bake-secrets:
    @bun "{{repo}}/src/cli.ts" bake-secrets

# Enable or disable a conversation history source.
[group('setup')]
history action source:
    @bun "{{repo}}/src/cli.ts" history "{{action}}" "{{source}}"

# Enable or disable scheduled generation for a feature.
[group('features')]
schedule action feature:
    @bun "{{repo}}/src/cli.ts" schedule "{{action}}" "{{feature}}"

# Enable or disable external publish for a feature.
[group('features')]
publish action feature:
    @bun "{{repo}}/src/cli.ts" publish "{{action}}" "{{feature}}"

# Disable history sources and features, then remove local entrypoints.
[group('setup')]
teardown:
    @bun "{{repo}}/src/cli.ts" teardown

# Show setup and feature state.
[group('operations')]
status:
    @bun "{{repo}}/src/cli.ts" status

# Browse the state DBs in a local Datasette web UI (read-only). Runs via uvx; nothing installed.
[group('operations')]
view-db:
    #!/usr/bin/env bash
    set -euo pipefail
    command -v uvx >/dev/null || { echo "error: uvx not found — install uv: https://docs.astral.sh/uv/"; exit 1; }
    shopt -s nullglob
    dbs=("${XDG_STATE_HOME:-$HOME/.local/state}"/kura/*.db)
    (( ${#dbs[@]} )) || { echo "error: no DB found in ${XDG_STATE_HOME:-$HOME/.local/state}/kura"; exit 1; }
    exec uvx datasette --open "${dbs[@]}"

# Show LLM token usage and cost per feature.
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

# Run the full Bun test suite (the Claude Code plugin's tests run under test-plugin).
[group('development')]
test:
    @bun test ./src ./tests

# Run only unit tests (colocated with source).
[group('development')]
test-unit:
    @bun test unit

# Run only contract tests (public process boundary).
[group('development')]
test-contract:
    @bun test tests/contract

# Validate the Claude Code plugin and run its tests against the engine. Requires the claude CLI.
[group('development')]
test-plugin:
    @claude plugin validate "{{repo}}/plugin"
    @claude plugin test "{{repo}}/plugin"

# Run only architecture tests (dependency rules).
[group('development')]
test-architecture:
    @bun test tests/architecture.test.ts

# Apply all declarative GitHub settings.
[group('github')]
apply-github: apply-github-settings apply-github-ruleset

# Apply the repository merge settings.
[group('github')]
apply-github-settings:
    #!/usr/bin/env bash
    set -euo pipefail
    command -v gh >/dev/null || { echo "error: gh CLI required"; exit 1; }
    gh api "repos/{{github_repo}}" -X PATCH --input "{{repo}}/.github/repo-settings.json" >/dev/null
    echo "repo settings applied to {{github_repo}}"

# Apply the main branch ruleset.
[group('github')]
apply-github-ruleset:
    #!/usr/bin/env bash
    set -euo pipefail
    command -v gh >/dev/null || { echo "error: gh CLI required"; exit 1; }
    command -v jq >/dev/null || { echo "error: jq required"; exit 1; }
    file="{{repo}}/.github/rulesets/main.json"
    if ! out=$(gh api "repos/{{github_repo}}/rulesets" 2>&1); then
        echo "$out" | grep -q "make this repository public" \
            && { echo "rulesets need a public repo or GitHub Pro — authored at $file; apply after going public"; exit 0; }
        echo "error: $out"; exit 1
    fi
    id=$(printf '%s' "$out" | jq -r '.[] | select(.name=="main") | .id' | head -1)
    if [ -n "$id" ]; then
        gh api "repos/{{github_repo}}/rulesets/$id" -X PUT --input "$file" >/dev/null
        echo "ruleset 'main' updated (id $id)"
    else
        gh api "repos/{{github_repo}}/rulesets" -X POST --input "$file" >/dev/null
        echo "ruleset 'main' created"
    fi

# Preview the release notes accumulated since the last vX.Y.Z tag (read-only)
[group('release')]
release-notes:
    @bunx git-cliff --unreleased --strip header

# Render the full changelog from git history (read-only)
[group('release')]
changelog:
    @bunx git-cliff --strip header

# Version comes from `git-cliff --bumped-version` (breaking → major, feat → minor,
# else patch) unless given explicitly; the tag push triggers the release workflow.
# Cut a release: preview the notes to publish, confirm, tag vX.Y.Z, and push
[group('release')]
release version="":
    #!/usr/bin/env bash
    set -euo pipefail
    v="{{version}}"
    if [ -z "$v" ]; then
        v="$(bunx git-cliff --bumped-version)"
        v="${v#v}"
    fi
    [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "error: version must be X.Y.Z (got: $v)"; exit 1; }
    tag="v$v"
    git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1 && { echo "error: tag already exists: $tag"; exit 1; }
    [ "$(git branch --show-current)" = "main" ] || echo "warning: not on main (current: $(git branch --show-current))"
    bunx git-cliff --unreleased --tag "$tag" --strip header
    read -r -p "tag and push $tag? [y/N] " answer
    [[ "$answer" =~ ^[Yy] ]] || { echo "aborted — nothing was tagged or pushed"; exit 1; }
    git tag -a "$tag" -m "$tag"
    git push origin "$tag"
    echo "pushed $tag — the release workflow will publish the notes"
