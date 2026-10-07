#!/usr/bin/env bun
// cli.ts — kura command の薄い dispatcher。処理本体は src/cli/ と domain module が持つ。

import { runConfig } from "./cli/config.ts";
import { runEnglishCard } from "./cli/english-card.ts";
import { runFeatures } from "./cli/features.ts";
import { helpText } from "./cli/help.ts";
import { runHistory } from "./cli/history.ts";
import { runLifecycle } from "./cli/lifecycle.ts";
import { runOperations } from "./cli/status.ts";
import { runUsage } from "./cli/usage.ts";

const usage = `usage: kura setup
       kura init-config
       kura bake-secrets
       kura history <enable|disable> <claude|codex|all>
       kura schedule <enable|disable> <timeline|english|all>
       kura publish <enable|disable> <timeline|english|all>
       kura teardown
       kura status
       kura doctor
       kura view-db
       kura usage [--days=N]
       kura search [--limit=N] <keyword...>
       kura show <session-id-or-prefix>
       kura english-card < prompt.txt
       kura --help
`;

function usageError(): number {
  process.stderr.write(usage);
  return 2;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if ((command === "--help" || command === "-h") && args.length === 0) {
    process.stdout.write(usage);
    return 0;
  }
  if (command !== undefined && (args.includes("--help") || args.includes("-h"))) {
    const text = helpText(command);
    if (text) {
      process.stdout.write(text);
      return 0;
    }
  }

  try {
    if (command === "setup" || command === "teardown") {
      return await runLifecycle(command, args);
    }
    if (command === "init-config" || command === "bake-secrets") {
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
    if (command === "english-card") {
      return await runEnglishCard(args);
    }
    if (command === "schedule" || command === "publish") {
      return await runFeatures(command, args);
    }
    if (command === "status" || command === "doctor" || command === "view-db") {
      return await runOperations(command, args);
    }
    if (command === "usage") {
      return await runUsage(args);
    }
    return usageError();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

process.exit(await main());
