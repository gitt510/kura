// store.ts — core (会話の保存と検索) の CLI adapter: enable / disable / hook / search / show。

import { join, resolve } from "node:path";

type StoreCommand = "enable" | "disable" | "hook" | "search" | "show";

const repo = resolve(import.meta.dir, "../..");

function usage(command: StoreCommand): number {
  const lines: Record<StoreCommand, string> = {
    enable: "usage: kura enable <claude|codex|all>\n",
    disable: "usage: kura disable <claude|codex|all>\n",
    hook: "usage: kura hook <claude|codex>\n",
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

export async function runStore(command: StoreCommand, args: string[]): Promise<number> {
  if (command === "enable" || command === "disable") {
    const [agent, extra] = args;
    if (agent === undefined || extra !== undefined) return usage(command);
    return runScript(join(repo, "src", "store", "hooks.ts"), [agent, command]);
  }

  // agent の hook が呼ぶ内部の入口。usage には載せない。
  if (command === "hook") {
    const [agent, extra] = args;
    if ((agent !== "claude" && agent !== "codex") || extra !== undefined) {
      return usage(command);
    }
    if (agent === "claude") await import("../store/claude.ts");
    else await import("../store/codex.ts");
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
    const { searchSessions } = await import("../store/search.ts");
    process.stdout.write(`${JSON.stringify(searchSessions(keywords, limit))}\n`);
    return 0;
  }

  if (args.length !== 1) return usage(command);
  const [idOrPrefix] = args;
  const { getSession, resolveSessionId } = await import("../store/query.ts");
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
