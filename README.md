![kura banner](docs/banner.png)

# kura — 蔵

A personal knowledge pipeline that stores Claude Code / Codex conversations in
SQLite and ships them back out to Discord as learning cards and activity
timelines. (*kura* / 蔵 is a traditional storehouse — you *put things away*
quietly and *take them out* only when you need them.)

## Why kura

- Memory layers like Mem0, Letta, or the MCP memory servers auto-inject
  extracted facts into the next session; kura never injects anything
- Storage is verbatim: a Stop hook stores the completed turn as-is — no
  extraction, no summarization, no LLM call at store time
- For Claude, a UserPromptSubmit hook additionally records each prompt the
  moment it is submitted, so a prompt whose turn never completes (interrupt,
  crash, quit) is still kept; the Stop hook replaces that provisional record
  with the verbatim transcript entry
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
| [1Password CLI](https://developer.1password.com/docs/cli/) | `op://` webhook references |

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
- `just history enable claude` wires both the Stop and UserPromptSubmit
  hooks; re-run it after upgrading from a Stop-only version
- Hooks are fail-open: a failed write is never retried and never blocks the
  session, so a prompt is lost only when its provisional write fails and its
  turn also never completes
- For Codex, run `/hooks` once after `just history enable codex`

## Skill installation

- `just setup` does not install the user-scope skills under `skills/`; the
  public skill is `search-history`
- `src/features/*/skills/` are used at project scope by the scheduled jobs;
  do not install them at user scope
- Install through exactly one channel; installing through both defines the
  same skill twice (`kura:search-history` and `search-history`)

```bash
# Claude Code plugin (namespaced as /kura:search-history)
/plugin marketplace add gitt510/kura
/plugin install kura@kura

# GitHub CLI (public preview)
gh skill install gitt510/kura search-history --scope user --agent claude-code

# npx
npx skills add gitt510/kura --skill search-history
```

## Configuration

```bash
just init-config
$EDITOR "${XDG_CONFIG_HOME:-$HOME/.config}/kura/config.json"
```

- `~/.config/kura/config.json` (mode 600) is the only configuration source;
  kura reads no settings from environment variables
- Without the file, every value below takes its default
- `just init-config` writes every key with its default; it migrates values
  from the old `~/.config/kura/env`, the checkout's `.env.ref`, and
  `~/.config/kura/publish.json` when they exist, and leaves those files for
  you to remove

```json
{
  "generator": "claude",
  "claude": { "model": null, "effort": null },
  "codex": { "model": null, "effort": null },
  "companion": { "model": "opus" },
  "discord": {
    "webhooks": { "english": "op://vault/item/field", "timeline": "https://discord.com/api/webhooks/..." },
    "avatars": { "claude": "https://...", "gpt": "https://..." }
  },
  "publish": { "enabled": [] }
}
```

| Key | Consumer |
| --- | --- |
| `generator` | Scheduled generation agent: `claude` (default) or `codex` |
| `claude.model` / `claude.effort` | Claude model / effort for scheduled generation |
| `codex.model` / `codex.effort` | Codex model / reasoning effort for scheduled generation |
| `companion.model` | Companion card model (default `opus`) |
| `discord.webhooks.<feature>` | Discord webhook for `english` / `timeline` |
| `discord.avatars.<family>` | Discord avatar per model family (`claude`, `gpt`, …) |
| `publish.enabled` | Features with Discord delivery opted in |

- `claude.*` / `codex.*` apply only to scheduled generation, and only while
  their agent is selected; normal CLI usage is untouched
- `null` model / effort injects no flag; the CLI's own default applies
- Invalid effort values are rejected at run time with the accepted list
- A webhook alone does not enable delivery; `just publish enable <feature>`
  adds the feature to `publish.enabled`
- A webhook may be a 1Password reference (`op://...`); `just bake-secrets`
  resolves every reference into `~/.local/state/kura/secrets.json` (mode 600),
  which delivery reads, so scheduled jobs need no 1Password sign-in

```bash
# Resolve op:// webhook references; re-run after changing one
just bake-secrets
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

```bash
kura companion [--tui] [--port=N] [--session=<prefix>]
```

- Watches history.db for user prompts submitted after startup and serves
  English feedback cards at `http://127.0.0.1:4989` (opens the browser on
  macOS; live updates over SSE)
- `--tui` logs cards to the terminal instead of starting a server: every line
  starts with a label — `[meta]` (`yyyy-mm-dd hh:mm:ss · project · branch`),
  `[input]`, then a `[status] processing …` placeholder replaced in place by
  the item lines, `[done] nothing to flag`, or `[error]` once generated
- One prompt = one card of `from → to` items, at most 5, no full translation
  or rewrite: `[romaji]` Japanese written in Latin letters → English,
  `[grammar]` a meaning-changing grammar mistake → the fix, `[natural]`
  grammatical but unnatural English → how a native developer says it
- Japanese written in kana / kanji, typos, spelling, and articles are never
  items; a prompt with nothing to report shows only its `[input]` line
- Cards are stored in `companion.db` before delivery; a page restart replays
  the latest 50 from storage (the TUI starts empty)
- Requires an enabled history source; Claude prompts arrive at submit time,
  Codex prompts at turn end
- Card generation runs headless Claude with `KURA_NO_HISTORY=1`, so companion
  runs are not recorded as history
- `companion` has no schedule and no Discord publish; it works only while the
  process is running

```bash
kura usage [--days=N]
just usage --days=7
```

- Prints one row per feature and model, plus a `TOTAL` row: calls, input,
  output, cache-read and cache-write tokens, and cost in USD
- `--days=N` limits the table to calls from the last N days; the default
  covers all recorded calls
- One row per call in `usage.db`, written by the agent runner
  (`src/lib/agent.ts`) — features never touch usage themselves
- Calls the agent reported as errors are recorded too — the tokens are spent
  either way — but a call that produced no parseable output (crash, dropped
  connection) reports no token counts and records nothing
- Cost comes from the agent's own output: the Claude CLI reports it, Codex's
  public events carry token counts only, so Codex rows show `-`
- With `"generator": "codex"`, every scheduled feature shows `-`; `companion`
  always runs Claude and always reports cost
- Claude's figure is what the API would charge for those tokens; under a
  subscription plan it is not an additional charge
- Recording is fail-open: a storage failure prints one line and never fails
  the generation it was measuring

| Feature | Stored output | Schedule |
| --- | --- | --- |
| `timeline` | Activity timeline | Hourly at `:00` |
| `english` | English learning card | Hourly at `:05` |
| `decisions` | Code decisions per repo | Hourly at `:10` |
| `companion` | Live English feedback cards | None — ad-hoc `kura companion` |

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
- `usage.db` stores per-call token counts, model names, and cost — metering
  only, no prompt or response content
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
