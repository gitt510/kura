#!/usr/bin/env bun
// manage.ts — publish policy の enable / disable / status を管理する。

import { resolveEnv } from "../lib/config.ts";
import {
  isPublishEnabled,
  PUBLISH_FEATURES,
  PUBLISH_WEBHOOKS,
  setPublishEnabled,
  type PublishFeature,
} from "../lib/publish-policy.ts";

type Action = "enable" | "disable" | "status" | "check";
const actions = ["enable", "disable", "status", "check"] as const;

function usageError(): never {
  process.stderr.write(
    "usage: bun manage.ts <timeline|english|briefing> <enable|disable|status|check>\n" +
      "       bun manage.ts all <disable|status>\n",
  );
  process.exit(2);
}

function runtimeError(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function isMember<T extends string>(values: readonly T[], value: string | undefined): value is T {
  return value !== undefined && values.includes(value as T);
}

const [targetArg, actionArg, extra] = process.argv.slice(2);
if (extra !== undefined || !isMember(actions, actionArg)) usageError();
if (targetArg === "all") {
  if (actionArg !== "disable" && actionArg !== "status") usageError();
} else if (!isMember(PUBLISH_FEATURES, targetArg)) {
  usageError();
}

const targets: readonly PublishFeature[] =
  targetArg === "all" ? PUBLISH_FEATURES : [targetArg];

if (actionArg === "status" || actionArg === "check") {
  let exitCode = 0;
  for (const feature of targets) {
    let enabled: boolean;
    try {
      enabled = isPublishEnabled(feature);
    } catch (error) {
      runtimeError(`publish policy を読めない: ${error}`);
    }
    process.stdout.write(`${feature}: ${enabled ? "enabled" : "disabled"}\n`);
    if (!enabled) exitCode = 1;
  }
  process.exit(actionArg === "status" ? 0 : exitCode);
}

if (actionArg === "enable") {
  const feature = targets[0]!;
  if (!resolveEnv(PUBLISH_WEBHOOKS[feature])) {
    runtimeError(`${PUBLISH_WEBHOOKS[feature]} is required before enabling publish`);
  }
}

try {
  setPublishEnabled(targets, actionArg === "enable");
} catch (error) {
  runtimeError(`publish policy を更新できない: ${error}`);
}
for (const feature of targets) {
  process.stdout.write(`${feature} publish ${actionArg}d\n`);
}
