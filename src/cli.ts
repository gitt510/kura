#!/usr/bin/env bun

// cli.ts — kura command の薄い dispatcher。処理本体は src/cli/ と domain module が持つ。

import { runConfig } from "./cli/config.ts";
import { runExtension } from "./cli/extension.ts";
import { runHandoff } from "./cli/handoff.ts";
import { helpText } from "./cli/help.ts";
import { runLifecycle } from "./cli/lifecycle.ts";
import { runStatus } from "./cli/status.ts";
import { runStore } from "./cli/store.ts";
import { runUsage } from "./cli/usage.ts";

// 直下は core (会話の保存と検索) と kura 全体の管理。extension はすべて `kura extension` の下。
const usage = `usage: kura enable <claude|codex|all>
       kura disable <claude|codex|all>
       kura search [--limit=N] <keyword...>
       kura show <session-id-or-prefix>
       kura extension run <timeline|english|akapen|tldr|verbatim> [args]
       kura extension schedule <enable|disable> <timeline|english|all>
       kura extension publish <enable|disable> <timeline|english|all>
       kura setup
       kura teardown
       kura status
       kura usage [--days=N]
       kura config
       kura init-config
       kura bake-secrets
       kura handoff <session-id>
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
    // `kura extension run <name> --help` はその extension の help、それ以外は subcommand の help。
    const [verb, name] = args;
    const text =
      (command === "extension" && verb === "run" && name !== undefined
        ? helpText(`extension run ${name}`)
        : null) ?? helpText(command);
    if (text) {
      process.stdout.write(text);
      return 0;
    }
  }

  try {
    if (command === "setup" || command === "teardown") {
      return await runLifecycle(command, args);
    }
    if (command === "config" || command === "init-config" || command === "bake-secrets") {
      return await runConfig(command, args);
    }
    if (
      command === "enable" ||
      command === "disable" ||
      command === "hook" ||
      command === "search" ||
      command === "show"
    ) {
      return await runStore(command, args);
    }
    if (command === "extension") {
      return await runExtension(args);
    }
    if (command === "handoff") {
      return await runHandoff(args);
    }
    if (command === "status") {
      return runStatus(args);
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
