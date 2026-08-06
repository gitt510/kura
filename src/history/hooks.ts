#!/usr/bin/env bun
// hooks.ts — agent の hook event と kura history source の配線を管理する。
// Claude は Stop (verbatim scan) と UserPromptSubmit (仮 row) の両方、Codex は
// 対応する submit event が無いため Stop のみ。enable は全 event を配線し、
// 部分的に壊れた配線も張り直す。enabled は全 event が揃った状態のみを指す。

import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

type Agent = "claude" | "codex";
type Action = "enable" | "disable" | "status" | "check";
type Hook = { type?: string; command?: string; [key: string]: unknown };
type HookGroup = { matcher?: string; hooks?: Hook[]; [key: string]: unknown };
type Settings = {
  hooks?: Record<string, HookGroup[] | undefined>;
  [key: string]: unknown;
};

const home = process.env.HOME;
if (!home) throw new Error("HOME is required");

const agents = ["claude", "codex"] as const;
const actions = ["enable", "disable", "status", "check"] as const;
const configs: Record<
  Agent,
  { label: string; path: string; command: string; events: string[]; owned: string[] }
> = {
  claude: {
    label: "Claude",
    path: `${home}/.claude/settings.json`,
    command: '"$HOME/.local/bin/kura" hook claude',
    events: ["Stop", "UserPromptSubmit"],
    owned: [
      '/.local/bin/kura" ingest claude',
      "/kura/src/history/ingest/claude.ts",
      "/kura/history/ingest.ts",
    ],
  },
  codex: {
    label: "Codex",
    path: `${home}/.codex/hooks.json`,
    command: '"$HOME/.local/bin/kura" hook codex',
    events: ["Stop"],
    owned: [
      '/.local/bin/kura" ingest codex',
      "/kura/src/history/ingest/codex.ts",
      "/kura/history/ingest-codex.ts",
    ],
  },
};

function usageError(): never {
  process.stderr.write(
    "usage: bun hooks.ts <claude|codex> <enable|disable|status|check>\n" +
      "       bun hooks.ts all <disable|status>\n",
  );
  process.exit(2);
}

function isMember<T extends string>(values: readonly T[], value: string | undefined): value is T {
  return value !== undefined && values.includes(value as T);
}

function load(settingsPath: string, events: string[]): Settings {
  if (!existsSync(settingsPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("root is not an object");
    }
    const hooks = (parsed as { hooks?: unknown }).hooks;
    if (
      hooks !== undefined &&
      (!hooks || typeof hooks !== "object" || Array.isArray(hooks))
    ) {
      throw new Error("hooks must be an object");
    }
    for (const event of events) {
      const groups = (hooks as Record<string, unknown> | undefined)?.[event];
      if (groups !== undefined && !Array.isArray(groups)) {
        throw new Error(`hooks.${event} must be an array`);
      }
      for (const [index, group] of ((groups as unknown[]) ?? []).entries()) {
        if (!group || typeof group !== "object" || Array.isArray(group)) {
          throw new Error(`hooks.${event}[${index}] must be an object`);
        }
        const groupHooks = (group as { hooks?: unknown }).hooks;
        if (groupHooks !== undefined && !Array.isArray(groupHooks)) {
          throw new Error(`hooks.${event}[${index}].hooks must be an array`);
        }
      }
    }
    return parsed as Settings;
  } catch (error) {
    process.stderr.write(`cannot parse ${settingsPath}: ${error}\n`);
    process.exit(1);
  }
}

function manage(agent: Agent, action: Action): number {
  const config = configs[agent];
  const configExists = existsSync(config.path);
  const settingsPath = configExists ? realpathSync(config.path) : config.path;
  const settings = load(settingsPath, config.events);
  const wired = (event: string): boolean =>
    (settings.hooks?.[event] ?? []).some((group) =>
      (group.hooks ?? []).some((hook) => hook.command === config.command),
    );
  // 全 event が揃って初めて enabled。部分配線 (旧版からの upgrade 途中など) は
  // disabled として報告し、enable が張り直す。
  const directEnabled = config.events.every(wired);

  if (action === "status" || action === "check") {
    process.stdout.write(`${agent}: ${directEnabled ? "enabled" : "disabled"}\n`);
    return action === "status" || directEnabled ? 0 : 1;
  }

  if (action === "enable" && directEnabled) {
    process.stdout.write(`${config.label} hook already enabled: ${config.path}\n`);
    return 0;
  }
  if (action === "disable" && !configExists) {
    process.stdout.write(`${config.label} hook already disabled: ${config.path}\n`);
    return 0;
  }

  const isOurs = (hook: Hook): boolean =>
    hook.type === "command" &&
    typeof hook.command === "string" &&
    (hook.command === config.command ||
      config.owned.some((fragment) => hook.command!.includes(fragment)));

  settings.hooks ??= {};
  for (const event of config.events) {
    const groups = settings.hooks[event] ?? (settings.hooks[event] = []);
    for (const group of groups) {
      if (group.hooks) group.hooks = group.hooks.filter((hook) => !isOurs(hook));
    }

    if (action === "enable") {
      const group = groups.find((candidate) => !candidate.matcher) ?? { hooks: [] };
      if (!groups.includes(group)) groups.push(group);
      group.hooks ??= [];
      group.hooks.push({ type: "command", command: config.command });
    } else {
      settings.hooks[event] = groups.filter((group) => (group.hooks ?? []).length > 0);
    }
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  const temp = `${settingsPath}.kura-${process.pid}`;
  writeFileSync(temp, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  renameSync(temp, settingsPath);
  process.stdout.write(`${config.label} hook ${action}d: ${config.path}\n`);
  return 0;
}

const [targetArg, actionArg, extra] = process.argv.slice(2);
if (extra !== undefined || !isMember(actions, actionArg)) usageError();
if (targetArg === "all") {
  if (actionArg !== "disable" && actionArg !== "status") usageError();
} else if (!isMember(agents, targetArg)) {
  usageError();
}

const targets: readonly Agent[] = targetArg === "all" ? agents : [targetArg];
let exitCode = 0;
for (const agent of targets) {
  if (manage(agent, actionArg) !== 0) exitCode = 1;
}
process.exit(exitCode);
