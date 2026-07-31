// history.ts — history source control と hook/search/show の CLI adapter。

import { join, resolve } from "node:path";

type HistoryCommand = "history" | "hook" | "ingest" | "search" | "show";

const repo = resolve(import.meta.dir, "../..");

function usage(command: HistoryCommand): number {
  const lines: Record<HistoryCommand, string> = {
    history: "usage: kura history <enable|disable> <claude|codex|all>\n",
    hook: "usage: kura hook <claude|codex>\n",
    ingest: "usage: kura hook <claude|codex>\n",
    search: "usage: kura search [--limit=N] <keyword...>\n",
    show: "usage: kura show <session-id-or-prefix>\n",
  };
  process.stderr.write(lines[command]);
  return 2;
}

function runScript(script: string, args: string[]): number {
  const result = Bun.spawnSync([process.execPath, script, ...args], {
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return result.exitCode ?? 1;
}

export async function runHistory(command: HistoryCommand, args: string[]): Promise<number> {
  if (command === "history") {
    const [action, source, extra] = args;
    if (
      (action !== "enable" && action !== "disable") ||
      source === undefined ||
      extra !== undefined
    ) {
      return usage(command);
    }
    return runScript(join(repo, "src", "history", "hooks.ts"), [source, action]);
  }

  // Running sessions can retain the previous Stop-hook command in memory after
  // hooks.json changes. Keep that hidden boundary working until the session exits.
  if (command === "hook" || command === "ingest") {
    const [agent, extra] = args;
    if ((agent !== "claude" && agent !== "codex") || extra !== undefined) {
      return usage(command);
    }
    if (agent === "claude") await import("../history/sources/claude.ts");
    else await import("../history/sources/codex.ts");
    return 0;
  }

  if (command === "search") {
    let limit = 8;
    const keywords: string[] = [];
    for (const arg of args) {
      const match = arg.match(/^--limit=(\d+)$/);
      if (match) limit = Number.parseInt(match[1]!, 10);
      else if (arg.startsWith("--")) return usage(command);
      else keywords.push(arg);
    }
    if (keywords.length === 0 || limit < 1 || limit > 100) return usage(command);
    const { searchSessions } = await import("../history/search.ts");
    process.stdout.write(`${JSON.stringify(searchSessions(keywords, limit))}\n`);
    return 0;
  }

  if (args.length !== 1) return usage(command);
  const [idOrPrefix] = args;
  const { getSession, resolveSessionId } = await import("../history/query.ts");
  const sessionId = resolveSessionId(idOrPrefix!);
  if (!sessionId) {
    process.stderr.write(`session not found: ${idOrPrefix}\n`);
    return 1;
  }
  const session = getSession(sessionId);
  if (!session) {
    process.stderr.write(`session not found: ${sessionId}\n`);
    return 1;
  }
  process.stdout.write(`${JSON.stringify(session)}\n`);
  return 0;
}
