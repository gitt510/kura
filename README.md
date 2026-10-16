![kura banner](docs/banner.png)

# kura — 蔵

- kura keeps Claude Code and Codex conversations verbatim in one SQLite database, `kura.db`
- Opt-in extensions build on `kura.db`: hourly timelines and English cards for Discord, and live English feedback in a Claude Code pane
- The name *kura* (蔵) means a storehouse: things are put away quietly and taken out only when needed

## Why kura

- Memory layers such as Mem0, Letta, or the MCP memory servers inject extracted facts into the next session, but kura never injects anything
- The Stop hook stores each completed turn as-is, with no extraction, summarization, or LLM call
- The Claude UserPromptSubmit hook records each prompt on submit, so an interrupted, crashed, or abandoned turn keeps its prompt
- The Stop hook replaces that provisional prompt with the verbatim transcript entry
- Stored history enters a session only when `search-history`, `kura search`, or `kura show` is invoked explicitly
- Recall never modifies `kura.db`

## Requirements

| Requirement | Needed for |
| --- | --- |
| macOS (`launchd`) | scheduled generation |
| [Bun](https://bun.sh/) | every command |
| [just](https://github.com/casey/just) | every `just` recipe |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Codex](https://developers.openai.com/codex/cli/) CLI | recording and generation |
| GitHub CLI, or Node.js with npx | user-scope skill install |
| A Discord webhook | Discord delivery |
| [1Password CLI](https://developer.1password.com/docs/cli/) | `op://` webhook references |
| tmux | `/kura-handoff`, `kura handoff` |

## Setup

```bash
git clone https://github.com/gitt510/kura.git
cd kura
just setup
```

- `just setup` installs the dependencies and links `~/.local/share/kura` to the checkout
- `just setup` deploys `~/.local/bin/kura` as a stable CLI
- `just setup` enables no recording, scheduled job, or publish

```bash
just enable claude
just enable codex
just status
```

- `just enable <agent>` starts recording that agent's conversations into `kura.db`
- `just enable claude` installs both the Stop and UserPromptSubmit hooks
- `just disable <agent>` stops recording and keeps what was recorded
- The hooks are fail-open: a failed write is never retried and never blocks the session
- A prompt is lost only when its provisional write fails and its turn never completes
- Codex needs one `/hooks` run after `just enable codex`

## Skill installation

- `search-history` is the only user-scope skill, and `just setup` does not install it
- The skills under `src/extensions/*/skills/` belong to the scheduled jobs and must stay out of user scope
- One install channel is enough, because two channels define the same skill twice (`kura:search-history` and `search-history`)

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

- `~/.config/kura/config.json` (mode 600) is kura's only configuration source
- kura reads no settings from environment variables
- Every key takes its default when the file is absent
- `just init-config` writes every key with its default and never overwrites an existing file

```json
{
  "extensions": {
    "akapen": { "agent": "claude", "model": "opus", "effort": null },
    "tldr": { "agent": "claude", "model": "opus", "effort": null },
    "verbatim": { "agent": "claude", "model": "opus", "effort": null },
    "timeline": {
      "agent": "claude", "model": null, "effort": null,
      "publish": { "enabled": false, "discord": { "webhook": null, "avatar": null } }
    },
    "english": {
      "agent": "claude", "model": null, "effort": null,
      "publish": { "enabled": false, "discord": { "webhook": null, "avatar": null } }
    }
  },
  "mod": {
    "companion": {
      "autoOpen": false,
      "widgets": ["akapen", "tldr"],
      "ratio": [0.5, 0.5]
    }
  }
}
```

| Key | Meaning | Default |
| --- | --- | --- |
| `extensions.<name>.agent` | generating CLI, `claude` or `codex` | `claude` |
| `extensions.<name>.model` | model for that extension only | `opus` for `akapen` / `tldr` / `verbatim`, CLI default otherwise |
| `extensions.<name>.effort` | effort in the agent's own vocabulary | CLI default |
| `extensions.<timeline\|english>.publish.enabled` | Discord delivery opt-in | `false` |
| `extensions.<timeline\|english>.publish.discord.webhook` | webhook URL or `op://` reference | `null` |
| `extensions.<timeline\|english>.publish.discord.avatar` | avatar URL for Discord posts | `null` |
| `mod.companion.autoOpen` | pane opens at session start | `false` |
| `mod.companion.widgets` | pane widgets, top to bottom, at most 3 | `["akapen", "tldr"]` |
| `mod.companion.ratio` | each widget's share of the rows | `[0.5, 0.5]` |

- `akapen`, `tldr`, and `verbatim` accept only `claude` as `agent`, and the config fails to load otherwise
- A `null` model or effort leaves the CLI's own default in place
- `model` and `effort` affect only that extension's generation, never normal CLI use
- An invalid effort fails at run time with the accepted values
- An unknown key fails to load with its path, such as `extensions.timeline has unknown key "webhok"`
- A key from an earlier version fails to load with its replacement, such as `config has unknown key "features" (renamed to "extensions")`
- `mod.companion.widgets` accepts `akapen`, `verbatim`, `tldr`, and `agents`
- An empty `mod.companion.widgets` turns the companion off
- `mod.companion.ratio` is divided by its sum, so its values need not add up to 1
- A `mod.companion.ratio` whose length differs from `widgets` fails to load
- A webhook alone does not enable delivery, because `just publish enable <extension>` sets `publish.enabled`
- `just bake-secrets` resolves every `op://` webhook into `~/.local/state/kura/secrets.json` (mode 600), so scheduled jobs need no 1Password sign-in

```bash
# Resolve op:// webhook references; re-run after changing one
just bake-secrets

# Print the effective config with defaults filled in; plain webhook URLs are redacted
kura config
```

## Companion pane

```bash
# Claude Code: toggle the pane
/kura-companion
```

- The companion ships in the `kura` Claude Code plugin
- The companion needs `kura` on `PATH` and a Claude Code build with plugin function hooks
- The companion draws only in its side pane, and Claude Code decides the pane's size
- The pane reopens in the state it was last left in, and `autoOpen` applies only before the first toggle
- A widget runs only while it is listed in `mod.companion.widgets`
- `/kura-companion` only reports that the companion is off when `mod.companion.widgets` is empty
- `mod.companion.*` takes effect at session start and each time the pane opens
- An unknown widget id is skipped with a toast

| Widget | Shows | Generated |
| --- | --- | --- |
| `akapen` | English feedback cards with something to fix | once per typed prompt |
| `verbatim` | newest typed prompt as native English | once per typed prompt |
| `tldr` | each turn as `> question` and a three-line summary | once per answer |
| `agents` | rows of `claude agents --json` | every 10 seconds while in view |

- `akapen`, `verbatim`, and `tldr` generate from session start, whether the pane is open or not
- Each session keeps its last 30 cards and summaries, and `verbatim` keeps only the newest translation
- A waiting row shows a spinner, the seconds since the prompt, and its step: `waiting`, `summarizing`, `proofreading`, or `interpreting`
- The card, translation, and turn of one prompt share the same step word and colors
- `akapen` lists cards oldest first
- An `akapen` card with nothing to fix shows `nothing to flag ✓` for 2 seconds
- A failed `akapen` card leaves the pane after 30 seconds
- `verbatim` shows the typed prompt dimmed under `[input]` and the English under a green `[native]`
- `verbatim` fits the English first, gives the prompt the remaining rows, and cuts either with `…`
- A prompt that `verbatim` would skip leaves the previous translation in place
- `tldr` shows a turn from the moment its prompt is typed and fills in the summary when it is ready
- `tldr` falls back to the typed prompt, cut at the pane width, when the summary has no question line
- A summary cut off by a plugin reload is made again at the next session start
- `agents` shows a summary line with the agent count and the count per status, then a table of `Status`, `Name`, `Cwd`, `Kind`, `SessionId`, and `Age`
- `agents` marks `busy` in green and `blocked` / `waiting` / `failed` in red, and bolds this session's row
- `agents` shows a background job's `state` (`blocked`, `done`) when it has no `status`
- `agents` refreshes the moment the pane comes into view and costs about 0.15 s of CPU per refresh
- `agents` raises a 🔔 toast whenever a session's turn completes, after its last background subagent finishes
- `agents` is cut from the bottom when it outgrows its rows, while `akapen` and `tldr` are cut from the top

## Handoff

```bash
# Claude Code: open a new session in a tmux pane, handed this session's id
/kura-handoff
# Anywhere else
kura handoff <session-id>
```

- `/kura-handoff` ships in the `kura` Claude Code plugin and needs `kura` on `PATH`
- Handoff fails outside tmux
- The new session opens to the right in the same directory and waits for the first instruction
- The new session receives only the session id and loads the conversation with `kura show` when a request depends on it
- The Stop hook stores the current turn only after it ends, so a handoff belongs after the turn

## Usage

```bash
kura search [--limit=N] <keyword...>
kura show <session-id-or-prefix>
```

- `kura search` returns matching sessions as JSON, ranked by distinct keywords matched, then recency
- `kura show` returns one session's metadata and full message list as JSON
- `kura show` accepts a unique session-id prefix

### Extensions

| Extension | Stored output | Schedule |
| --- | --- | --- |
| `timeline` | activity timeline (`timeline` table) | hourly at `:00` |
| `english` | English learning card (`english` table) | hourly at `:05` |
| `akapen` | nothing | on demand |
| `tldr` | nothing | on demand |
| `verbatim` | nothing | on demand |

- `kura extension run <name>` is the single entrypoint for every extension
- The companion pane and the scheduled jobs run the same command
- `kura extension run <name> --help` prints that extension's contract
- `akapen`, `tldr`, and `verbatim` send Claude only kura's own instructions and the input, with no tools, MCP servers, skills, settings, or `CLAUDE.md`
- Generation by any extension is never recorded as history

#### akapen

```bash
echo "I make mod. kono houhou is good" | kura extension run akapen
```

- `akapen` takes one prompt on stdin and prints one English feedback card as JSON: `{status, model, items}`
- Each item is a `{kind, from, to}` pair, with at most 5 items per prompt and no full translation or rewrite

| Kind | `from` | `to` |
| --- | --- | --- |
| `romaji` | Japanese in Latin letters | English |
| `grammar` | meaning-changing grammar mistake | the fix |
| `natural` | grammatical but unnatural English | native developer phrasing |

- `akapen` never flags kana or kanji, typos, spelling, or articles
- `to` is English only, with no explanation or rule name
- A prompt under 3 characters or starting with `<`, `/`, or `!` prints `{"status":"skipped"}` without calling the model
- A prompt over 3000 characters is cut to its last 1500

#### tldr

```bash
echo '{"turns": [{"question": "...", "answer": "..."}]}' | kura extension run tldr
```

- `tldr` takes `turns` oldest first and prints the last answer compressed into three lines as JSON: `{status, model, text, question}`
- The three lines are the assistant's own next reply to the user saying `長い。3行で。`
- `question` is the last question on one line, or `null` when the reply gives none
- Up to 3 turns before the last one serve as context
- Invalid stdin exits 2 without calling the model

#### verbatim

```bash
echo '{"input": "なんだっけ、あー、うーんと、わすれちゃった。まあ。fix this"}' | kura extension run verbatim
```

- `verbatim` prints `input` as the English a native developer would have typed, as JSON: `{status, model, text}`
- `verbatim` keeps the whole prompt in order, including Japanese, English, romaji, fillers, hesitations, and asides
- Code, file names, and commands stay unchanged
- Each quoted line block, fenced code block, or pasted block becomes `[pasted]`
- The optional `turns` (`[{question, answer}, ...]`, oldest first) lends its last turn as context, which is never translated
- An `input` under 3 characters or starting with `<`, `/`, or `!` prints `{"status":"skipped"}` without calling the model
- An `input` over 3000 characters is cut to its last 1500
- Invalid stdin exits 2 without calling the model

#### timeline and english

```bash
kura extension run timeline [<YYYY-MM-DD> <hour 0-23>]
kura extension run english [<YYYY-MM-DD> <hour 0-23>]
```

- Each command generates, stores, and, when opted in, publishes one JST hour
- The target hour defaults to the last completed hour
- An hour already generated or published is skipped

```bash
just schedule enable timeline
just publish enable timeline
just status
```

- `just schedule` toggles hourly generation, and `just publish` toggles Discord delivery
- Generation and delivery are separate opt-ins per extension
- `enable all` does not exist, so each agent, extension, and publisher is enabled explicitly
- `just disable all` and `just schedule|publish disable all` turn off a whole control at once
- A failed publish is retried from the stored row without rerunning the LLM
- `just status` shows setup state, the generation runtime, and each extension's schedule and publish state without changing anything
- `just status` uses color only in interactive terminals, and `NO_COLOR` turns it off

### Usage and cost

```bash
kura usage [--days=N]
just usage --days=7
```

- `kura usage` prints one row per extension and model, plus a `TOTAL` row: calls, input, output, cache-read and cache-write tokens, and cost in USD
- `--days=N` limits the table to the last N days, and the default covers all recorded calls
- Calls that the agent reported as errors are counted, because their tokens are spent
- A call that produced no parseable output records nothing
- Codex rows show `-` as cost, because Codex reports token counts only
- Claude's cost is the API price of those tokens, not an extra charge under a subscription plan
- A usage storage failure prints one line and never fails the generation

## Security

- Scheduled generation runs repo-owned, fixed skills through the configured agent
- Scheduled jobs run from the checkout directory
- Each agent reads its materials from and writes its output to `/tmp/kura-<extension>`

| Agent | Allowed tools | Sandbox | Approvals | Write scope | Network |
| --- | --- | --- | --- | --- | --- |
| Claude Code | fixed allowlist | none | auto-denied | `/tmp/kura-<extension>` | denied |
| Codex | any command | Seatbelt | auto-rejected | checkout and temp | disabled |

- The Claude Code allowlist permits `Read` and `Write` on `/tmp/kura-<extension>` and `Read` on the checkout, with no bypass option
- Codex runs under `--sandbox workspace-write` and `--ask-for-approval never`, with unrestricted reads
- Codex's write scope is wider than what the skills write
- Unattended runs are never recorded as history and have stdin closed
- Webhook URLs live only in the XDG config or `secrets.json`, never in the checkout
- `src/extensions/*/skills/` and `src/agent/run.ts` deserve a review before scheduled generation is enabled

## Privacy and data

| Data | Location | Mode |
| --- | --- | --- |
| `kura.db` and logs | `${XDG_STATE_HOME:-$HOME/.local/state}/kura` | `0700` |
| Configuration | `${XDG_CONFIG_HOME:-$HOME/.config}/kura` | `0600` |

- `kura.db` holds every table: recorded conversations, each extension's output, and LLM usage
- Recorded conversations include user and assistant messages, Claude tool-use names and inputs, session ids, working directories, timestamps, and model metadata
- The `usage` table stores token counts, model names, and cost, with no prompt or response content
- kura does not encrypt `kura.db`
- The first run after upgrading copies `history.db`, `timeline.db`, `english.db`, and `usage.db` into `kura.db` and leaves the old files in place
- The old database files are safe to delete once `kura.db` looks right
- An enabled scheduled extension sends the relevant stored conversations to the configured agent and its LLM provider
- Generated output reaches Discord only when publishing is enabled for that extension
- kura manages no retention or backups

## Teardown

```bash
just teardown
```

- `just teardown` disables every publish, scheduled job, and recording hook, then removes the entrypoints from `just setup`
- `just teardown` is safe to run repeatedly
- `just teardown` keeps the state and config directories and externally installed skills, and reports the kept paths
- Full removal also needs those reported directories and any externally installed skills deleted

## Development

```bash
just test               # full Bun suite
just test-unit          # pure logic and small I/O tests colocated with src
just test-contract      # public contract tests across CLI, hooks, and SQLite
just test-architecture  # dependency rules
just test-plugin        # Claude Code plugin validation and tests against the engine
```
