// help.ts — subcommand ごとの -h / --help 本文。cli.ts が dispatch 前に一括で引く。
// 引数エラー時の 1 行 usage は従来どおり各 adapter が所有する。

const helpTexts: Record<string, string> = {
  setup: `usage: kura setup

Link this checkout into place: ~/.local/share/kura -> the repo, and
~/.local/bin/kura -> src/cli.ts. Refuses to replace a path it does not
own. Idempotent.
`,
  config: `usage: kura config

Print the effective config as JSON: config.json with every unset key at its
default. Webhooks that are not op:// references are printed as <redacted>.
`,
  "init-config": `usage: kura init-config

Create the config file (~/.config/kura/config.json, mode 600) with every
key at its default. Fails if the file already exists.
`,
  "bake-secrets": `usage: kura bake-secrets

Resolve every op:// reference in extensions.<name>.publish.discord.webhook in config.json through
1Password (op read) into the state dir's secrets.json (mode 600), which the
publish jobs read. Run it again after changing a reference.
`,
  enable: `usage: kura enable <claude|codex|all>

Start recording an agent's conversations into kura.db by installing its
hooks (claude: Stop + UserPromptSubmit, codex: Stop).
`,
  disable: `usage: kura disable <claude|codex|all>

Stop recording an agent's conversations by removing its hooks. Recorded
conversations stay in kura.db.
`,
  extension: `usage: kura extension run <name> [args]
       kura extension schedule <enable|disable> <timeline|english|all>
       kura extension publish <enable|disable> <timeline|english|all>

Extensions are opt-in features built on top of kura.

  run       run one extension once; see kura extension run <name> --help
  schedule  toggle the launchd job that runs timeline / english every hour
  publish   toggle Discord delivery for timeline / english; disabled
            extensions still run and record, they just stop delivering

extensions:
  timeline  summarize one hour of recorded sessions
  english   turn one hour of your prompts into an English practice card
  akapen    English feedback on one prompt
  tldr      three-line summary of the last answer
  verbatim  one prompt said again as native English
`,
  teardown: `usage: kura teardown

Disable publishing, scheduled jobs, and recording hooks, then remove the
symlinks created by setup. State (~/.local/state/kura) and config
(~/.config/kura) are retained.
`,
  status: `usage: kura status

Show setup state (runtime, cli, config, kura.db, hooks) and
per-extension state (schedule / publish) as tables.
`,
  usage: `usage: kura usage [--days=N]

Show recorded LLM token usage and cost, aggregated per feature and model.

options:
  --days=N    restrict to the last N days (default: all time)
  -h, --help  show this help
`,
  search: `usage: kura search [--limit=N] <keyword...>

Search recorded Claude Code / Codex sessions in kura.db by keyword.
Keywords are OR-matched as case-insensitive substrings; sessions are ranked by
distinct keywords matched, then recency, then number of matching messages.

options:
  --limit=N   max sessions to return (default 8, range 1-100)
  -h, --help  show this help

output (single JSON object on stdout):
  { query: { keywords }, count, hits: [ { session, short, cwd,
    span: { start, end }, matched, hits, size, snippets } ] }

  count      total sessions matched (hits is capped at --limit)
  span       first/last matching message, JST "YYYY-MM-DD HH:MM"
  size       session's total text volume — cost estimate for a full load
  snippets   up to 3 excerpts, each labeled with the keyword it matched

examples:
  kura search deploy
  kura search --limit=3 test refactor
`,
  show: `usage: kura show <session-id-or-prefix>

Load one recorded session as JSON: meta (session, cwd, model, volume)
and the full message list. Accepts a unique session-id prefix — find
candidates with: kura search
`,
  handoff: `usage: kura handoff <session-id>

Open a new Claude Code session in a tmux pane to the right, in the current
directory. The session gets only the given session id in its system prompt
and loads that conversation with kura show when a request depends on it.
It starts idle: type the first instruction there. Fails outside tmux.
`,
  "extension run timeline": `usage: kura extension run timeline [<YYYY-MM-DD> <hour 0-23>]

Summarize one JST hour of recorded sessions into kura.db, then publish
it to Discord when publishing is enabled. Without arguments, targets the
last completed hour. An hour already generated (or published) is skipped.
The scheduled job runs this command.
`,
  "extension run english": `usage: kura extension run english [<YYYY-MM-DD> <hour 0-23>]

Turn one JST hour of your prompts into an English practice card in
kura.db, then publish it to Discord when publishing is enabled. Without
arguments, targets the last completed hour. An hour already generated (or
published) is skipped. The scheduled job runs this command.
`,
  "extension run akapen": `usage: kura extension run akapen < prompt.txt

Turn one prompt read from stdin into an English feedback card and print it
as JSON: {status, model, items}, each item {kind, from, to} with kind one of
romaji, grammar, natural. Prompts under 3 characters or starting with <, /
or ! print {"status":"skipped"}. Nothing is stored. The model is
extensions.akapen.model in config.json (default opus).
`,
  "extension run tldr": `usage: kura extension run tldr < turns.json

Compress the last answer of a conversation into three lines and print it as
JSON: {status, model, text, question}. question is the last question in one
line, or null when the reply did not give one. stdin is {"turns": [{question, answer}, ...]},
oldest first; up to 3 turns before the last one are passed as context.
Nothing is stored. The model is extensions.tldr.model in config.json (default opus).
`,
  "extension run verbatim": `usage: kura extension run verbatim < prompt.json

Say one prompt again as the English a native developer would have typed,
whole and verbatim (fillers and asides kept; quoted, fenced or pasted
material becomes [pasted]), and print it as JSON: {status, model, text}.
stdin is {"input": string, "turns"?: [{question, answer}, ...]}, the turns
before it oldest first; the last one is passed as context. An input under 3
characters or starting with <, / or ! prints {"status":"skipped"}. Invalid
stdin exits 2. Nothing is stored. The model is extensions.verbatim.model in
config.json (default opus).
`,
};

export function helpText(command: string): string | null {
  return helpTexts[command] ?? null;
}
