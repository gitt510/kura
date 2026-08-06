![kura banner](docs/banner.png)

# kura — 蔵

A personal knowledge pipeline that stores Claude Code / Codex conversations in
SQLite and ships them back out to Discord as learning cards and activity
timelines. (*kura* / 蔵 is a traditional storehouse — you *put things away*
quietly and *take them out* only when you need them.)

## Why kura

- Memory layers like Mem0, Letta, or the MCP memory servers auto-inject
  extracted facts into the next session; kura never injects anything
- Storage is verbatim: a Stop hook stores the conversation as-is — no
  extraction, no summarization, no LLM call at store time
- Recall is deliberate: stored history enters a session only when
  `search-history` (or `kura search` / `kura show`) is invoked explicitly
- Recall reads the history database without modifying it

## Requirements

| Requirement | Needed for |
| --- | --- |
| macOS (`launchd`) | scheduled generation jobs |
| [Bun](https://bun.sh/) | all commands |
| [just](https://github.com/casey/just) | all commands |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Codex](https://developers.openai.com/codex/cli/) CLI | history storage and scheduled generation |
| GitHub CLI or Node.js / npx | installing user-scope skills |
| A Discord webhook | Discord delivery |
| [1Password CLI](https://developer.1password.com/docs/cli/) | the `.env.ref` integration |

## Setup

```bash
git clone https://github.com/gitt510/kura.git
cd kura
just setup
```

- `just setup` creates the local entrypoints only; no history source,
  scheduled job, or publish is enabled
- `~/.local/share/kura` is symlinked to the checkout
- `~/.local/bin/kura` is deployed as a stable CLI

```bash
just history enable claude
just history enable codex
just doctor
```

- History storage is enabled per agent
- For Codex, run `/hooks` once after `just history enable codex`

## Skill installation

- `just setup` does not install the user-scope skills under `skills/`; the
  public skill is `search-history`
- `src/features/*/skills/` are used at project scope by the scheduled jobs;
  do not install them at user scope

```bash
# GitHub CLI (public preview)
gh skill install gitt510/kura search-history --scope user --agent claude-code

# npx
npx skills add gitt510/kura --skill search-history
```

## Configuration

```bash
just init-env
$EDITOR "${XDG_CONFIG_HOME:-$HOME/.config}/kura/env"
```

| Consumer | Environment variable |
| --- | --- |
| Scheduled generation agent | `KURA_GENERATOR` (`claude`, the default, or `codex`) |
| Claude model for scheduled generation | `KURA_CLAUDE_MODEL` |
| Claude effort for scheduled generation | `KURA_CLAUDE_EFFORT` |
| Codex model for scheduled generation | `KURA_CODEX_MODEL` |
| Codex reasoning effort for scheduled generation | `KURA_CODEX_EFFORT` |
| English learning card | `KURA_DISCORD_WEBHOOK_ENGLISH` |
| Activity timeline | `KURA_DISCORD_WEBHOOK_TIMELINE` |
| Claude-family Discord avatar | `KURA_DISCORD_AVATAR_CLAUDE` |
| GPT-family Discord avatar | `KURA_DISCORD_AVATAR_GPT` |

- The process environment takes precedence; the XDG config file is the
  fallback
- A `.env` in the checkout root is not a supported configuration path
- `KURA_CLAUDE_*` / `KURA_CODEX_*` apply only to scheduled generation, and
  only while their agent is selected; normal CLI usage is untouched
- Unset model / effort variables inject no flag; the CLI's own default applies
- Invalid effort values are rejected at run time with the accepted list
- Webhook configuration alone does not enable delivery; `just publish enable
  <feature>` records the opt-in in the config directory's `publish.json`

```bash
# Materialize secrets from 1Password through a local-only .env.ref
cp .env.ref.example .env.ref
$EDITOR .env.ref
just bake-env
```

## Usage

```bash
kura search sqlite schema
kura show <session-id-or-prefix>
kura decisions <repo>
```

- These commands return JSON
- `kura decisions` returns the stored decisions whose working directory
  matches `<repo>` by path suffix, one entry per title with the newest
  content, newest first

| Feature | Stored output | Schedule |
| --- | --- | --- |
| `timeline` | Activity timeline | Hourly at `:00` |
| `english` | English learning card | Hourly at `:05` |
| `decisions` | Code decisions per repo | Hourly at `:10` |

```bash
just schedule enable timeline
just publish enable timeline
just status
```

- Scheduled generation stores its output locally; Discord delivery is a
  separate per-feature opt-in
- Generation and publish have independent `enable` / `disable` controls
- `enable all` is not provided; each source, feature, and publisher is
  enabled explicitly
- `just history|schedule|publish disable all` disables a whole control at once
- Generated data is persisted before publish; a failed publish is retried
  from the stored row without rerunning the LLM
- `just status` shows setup state, the generation runtime, and each feature's
  database / schedule / publish state without changing local state
- `just status` uses color only in interactive terminals; `NO_COLOR` disables
  it explicitly

## Security

- Scheduled generation runs repo-owned, fixed skills through the configured
  agent (`src/lib/agent.ts`)
- Scheduled jobs run from the checkout directory (`src/launchd/run.sh`)
- Both agents do the same work: read the materials JSON from the feature's
  exchange directory under `/tmp` and write `generated.json` back to it

| Agent       | Allowed tools   | Sandbox     | Approvals     | Write scope     | Network  |
| ----------- | --------------- | ----------- | ------------- | --------------- | -------- |
| Claude Code | fixed allowlist | not engaged | auto-denied   | exchange dir    | denied   |
| Codex       | any command     | Seatbelt    | auto-rejected | checkout + temp | disabled |

- Claude Code allowlist (`--allowedTools`): `Read`/`Write` on the exchange
  directory, `Read` on the checkout; there is no bypass option
- Codex runs any command, but inside `--sandbox workspace-write`
  (`--ask-for-approval never`); reads are not restricted
- Codex's writable area (the whole checkout) is wider than what the skills
  actually write
- Unattended runs set `KURA_NO_HISTORY=1` and are not recorded as history
- Unattended runs have stdin closed
- Webhook URLs are never stored in the checkout; keep them in the process
  environment or the XDG config
- Review `src/features/*/skills/` and `src/lib/agent.ts` before enabling
  scheduled generation

## Privacy and data

| Data | Location | Mode |
| --- | --- | --- |
| Databases and logs | `${XDG_STATE_HOME:-$HOME/.local/state}/kura` | `0700`, created on first use |
| Configuration | `${XDG_CONFIG_HOME:-$HOME/.config}/kura` | `0600` |

- Stored data: user and assistant messages, Claude tool-use names and inputs,
  session IDs, working directories, timestamps, model metadata, and generated
  output
- The SQLite databases are not encrypted by kura
- When a scheduled feature is enabled, relevant stored conversation content
  is processed through the configured agent and its LLM provider
- Generated output is sent to Discord only when publishing is explicitly
  enabled for that feature
- kura does not manage retention or backups; retaining, backing up, and
  deleting local data is the user's responsibility

## Teardown

```bash
just teardown
```

- Disables every publish policy, scheduled generation job, and history
  source, then removes the entrypoints created by `just setup`
- Safe to run repeatedly
- Leaves intact: the state and config directories, and skills installed by an
  external skill manager
- Reports the retained paths; never deletes generated data
- Full removal: run `just teardown`, delete the reported state and config
  directories, then remove externally installed skills

## Development

```bash
just test
```

```bash
just test-unit          # pure logic / small I/O tests colocated with src
just test-contract      # public contract tests across CLI, hooks, and SQLite
just test-architecture  # dependency rules
```
