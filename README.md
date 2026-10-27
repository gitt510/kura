![kura banner](docs/banner.png)

# kura — 蔵

- kura keeps Claude Code and Codex conversations verbatim in one SQLite database, `kura.db`
- A Claude Code pane gives live English feedback and three-line summaries beside the session
- The name *kura* (蔵) means a storehouse: things are put away quietly and taken out only when needed

## Why kura

- kura never injects anything into a session, unlike memory layers such as Mem0 or Letta
- Stored history enters a session only through an explicit `search-history`, `kura search`, or `kura show`

## Requirements

| Requirement | Needed for |
| --- | --- |
| macOS, [Bun](https://bun.sh/), [just](https://github.com/casey/just) | everything |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Codex](https://developers.openai.com/codex/cli/) | recording |
| Claude Code | the companion pane |
| tmux | handoff |

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

- `config.json` holds every kura setting; recording is switched by `just enable` / `just disable`, which edit each agent's hooks file
- [`src/config.ts`](src/config.ts) defines every key, its default, and its validation

| Consumer | Secret | Non-secret |
| --- | --- | --- |
| `akapen` / `tldr` / `verbatim` | — | `extensions.<name>`: `agent`, `model`, `effort` |
| companion pane | — | `mod.companion`: `autoOpen`, `widgets`, `ratio` |
| recording hooks | — | enabled or not, in each agent's hooks file |
| `claude` / `codex` CLI | OAuth token | — |

## Extensions

- An extension generates one result with an LLM and prints it as JSON on stdout
- `akapen`, `tldr`, and `verbatim` are the extensions; the companion pane consumes them

```bash
kura extension run <name> --help
kura usage                        # tokens and cost per extension
```

## Claude Code mods

```bash
/kura-companion   # toggle the companion pane
/kura-handoff     # hand this session to a new tmux pane
```

- Both mods ship in the `kura` plugin
- The companion runs an extension only while its widget is listed in `mod.companion.widgets`

| Widget | Shows |
| --- | --- |
| `akapen` | English feedback on each typed prompt |
| `verbatim` | the newest prompt as native English |
| `tldr` | each answer in three lines |
| `agents` | the sessions in `claude agents` |

## Privacy

- `kura.db` lives unencrypted in `~/.local/state/kura`
- A companion widget sends the newest prompt or the latest turns to Claude
- `just teardown` removes everything `just setup` created and keeps `kura.db` and the config

## Development

```bash
just test
```
