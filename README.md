![kura banner](docs/banner.png)

# kura — 蔵

- kura keeps Claude Code and Codex conversations verbatim in one SQLite database, `kura.db`
- Opt-in extensions build on `kura.db`, from hourly Discord digests to live English feedback in a Claude Code pane
- The name *kura* (蔵) means a storehouse: things are put away quietly and taken out only when needed

## Why kura

- kura never injects anything into a session, unlike memory layers such as Mem0 or Letta
- Stored history enters a session only through an explicit `search-history`, `kura search`, or `kura show`

## Requirements

| Requirement | Needed for |
| --- | --- |
| macOS, [Bun](https://bun.sh/), [just](https://github.com/casey/just) | everything |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Codex](https://developers.openai.com/codex/cli/) | recording and generation |
| tmux | handoff |
| Discord webhook, [1Password CLI](https://developer.1password.com/docs/cli/) | Discord delivery |

## Setup

```bash
git clone https://github.com/gitt510/kura.git && cd kura
just setup           # entrypoints only; nothing is recorded yet
just enable claude   # or codex; Codex also needs one /hooks run
just status
```

- `just disable <agent>` stops recording and keeps what was recorded

## Skill

```bash
# Claude Code
/plugin marketplace add gitt510/kura
/plugin install kura@kura
# Codex
npx skills add gitt510/kura --skill search-history
```

- The `kura` plugin bundles `search-history`, the companion pane, and handoff

## Configuration

```bash
just init-config   # writes ~/.config/kura/config.json with every default
kura config        # prints the effective config
```

- `config.json` is kura's only configuration source
- `extensions.<name>` sets each extension's agent, model, and effort
- `mod.companion` sets the pane's widgets and their shares of the rows

## Claude Code mods

```bash
/kura-companion   # toggle the companion pane
/kura-handoff     # hand this session to a new tmux pane
```

- Both mods ship in the `kura` plugin

| Widget | Shows |
| --- | --- |
| `akapen` | English feedback on each typed prompt |
| `verbatim` | the newest prompt as native English |
| `tldr` | each answer in three lines |
| `agents` | the sessions in `claude agents` |

## Extensions

| Extension | Output | Schedule |
| --- | --- | --- |
| `timeline` | activity timeline, optionally to Discord | hourly |
| `english` | English learning card, optionally to Discord | hourly |
| `akapen` / `tldr` / `verbatim` | JSON on stdout | on demand |

```bash
kura extension run <name> --help
just schedule enable timeline   # hourly generation
just publish enable timeline    # Discord delivery
kura usage                      # tokens and cost per extension
```

## Privacy

- `kura.db` lives unencrypted in `~/.local/state/kura`
- A scheduled extension sends stored conversations to its agent's LLM provider
- Output reaches Discord only when publishing is enabled for that extension
- `just teardown` removes everything `just setup` created and keeps `kura.db` and the config

## Development

```bash
just test
```
