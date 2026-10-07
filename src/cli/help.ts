// help.ts — subcommand ごとの -h / --help 本文。cli.ts が dispatch 前に一括で引く。
// 引数エラー時の 1 行 usage は従来どおり各 adapter が所有する。

const helpTexts: Record<string, string> = {
  setup: `usage: kura setup

Link this checkout into place: ~/.local/share/kura -> the repo, and
~/.local/bin/kura -> src/cli.ts. Refuses to replace a path it does not
own. Idempotent.
`,
  "init-config": `usage: kura init-config

Create the config file (~/.config/kura/config.json, mode 600) with every
key at its default. Fails if the file already exists.
`,
  "bake-secrets": `usage: kura bake-secrets

Resolve every op:// reference under discord.webhooks in config.json through
1Password (op read) into the state dir's secrets.json (mode 600), which the
publish jobs read. Run it again after changing a reference.
`,
  history: `usage: kura history <enable|disable> <claude|codex|all>

Toggle conversation recording per agent by installing or removing the
agent hooks (claude: Stop + UserPromptSubmit, codex: Stop) that write
into history.db.
`,
  schedule: `usage: kura schedule <enable|disable> <timeline|english|all>

Toggle the launchd jobs that run each feature on its schedule.
`,
  publish: `usage: kura publish <enable|disable> <timeline|english|all>

Toggle Discord publishing per feature. Disabled features still run and
record; they just stop delivering to the webhook.
`,
  teardown: `usage: kura teardown

Disable publishing, scheduled jobs, and history hooks, then remove the
symlinks created by setup. State (~/.local/state/kura) and config
(~/.config/kura) are retained.
`,
  status: `usage: kura status

Show setup state (cli, env, history.db, hooks) and per-feature state
(database / schedule / publish) as tables.
`,
  doctor: `usage: kura doctor

Check the runtime prerequisites (bun, symlinks, state dir) and print
HEALTHY or NEEDS SETUP. Exits non-zero when setup is needed.
`,
  "view-db": `usage: kura view-db

Open every *.db under the kura state dir in Datasette (requires uvx).
`,
  usage: `usage: kura usage [--days=N]

Show recorded LLM token usage and cost, aggregated per feature and model.

options:
  --days=N    restrict to the last N days (default: all time)
  -h, --help  show this help
`,
  search: `usage: kura search [--limit=N] <keyword...>

Search recorded Claude Code / Codex sessions in history.db by keyword.
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
  "english-card": `usage: kura english-card < prompt.txt

Turn one prompt read from stdin into an English feedback card and print it
as JSON: {status, model, items}, each item {kind, from, to} with kind one of
romaji, grammar, natural. Prompts under 3 characters or starting with <, /
or ! print {"status":"skipped"}. Nothing is stored. The model is
english-card.model in config.json (default opus).
`,
};

export function helpText(command: string): string | null {
  return helpTexts[command] ?? null;
}
