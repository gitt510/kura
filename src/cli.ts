#!/usr/bin/env bun
// cli.ts — kura command の薄い dispatcher。処理本体は src/cli/ と domain module が持つ。

import { runCompanion } from "./cli/companion.ts";
import { runConfig } from "./cli/config.ts";
import { runDecisions } from "./cli/decisions.ts";
import { runFeatures } from "./cli/features.ts";
import { runHistory } from "./cli/history.ts";
import { runLifecycle } from "./cli/lifecycle.ts";
import { runOperations } from "./cli/status.ts";

const usage = `usage: kura setup
       kura init-env
       kura bake-env
       kura history <enable|disable> <claude|codex|all>
       kura schedule <enable|disable> <timeline|english|decisions|all>
       kura publish <enable|disable> <timeline|english|all>
       kura teardown
       kura status
       kura doctor
       kura view-db
       kura search [--limit=N] <keyword...>
       kura show <session-id-or-prefix>
       kura decisions [--limit=N] <repo>
       kura companion [--port=N] [--session=<prefix>]
       kura --help
`;

function usageError(): number {
  process.stderr.write(usage);
  return 2;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" && args.length === 0) {
    process.stdout.write(usage);
    return 0;
  }

  try {
    if (command === "setup" || command === "teardown") {
      return await runLifecycle(command, args);
    }
    if (command === "init-env" || command === "bake-env") {
      return await runConfig(command, args);
    }
    if (
      command === "history" ||
      command === "hook" ||
      command === "ingest" ||
      command === "search" ||
      command === "show"
    ) {
      return await runHistory(command, args);
    }
    if (command === "decisions") {
      return await runDecisions(args);
    }
    if (command === "companion") {
      return await runCompanion(args);
    }
    if (command === "schedule" || command === "publish") {
      return await runFeatures(command, args);
    }
    if (command === "status" || command === "doctor" || command === "view-db") {
      return await runOperations(command, args);
    }
    return usageError();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

process.exit(await main());
