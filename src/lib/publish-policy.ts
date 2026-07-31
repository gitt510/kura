// publish-policy.ts — external publish の明示 opt-in を XDG config で管理する。

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

type Environment = Readonly<Record<string, string | undefined>>;

export const PUBLISH_FEATURES = ["timeline", "english", "briefing"] as const;
export type PublishFeature = (typeof PUBLISH_FEATURES)[number];

export const PUBLISH_WEBHOOKS: Record<PublishFeature, string> = {
  timeline: "KURA_DISCORD_WEBHOOK_TIMELINE",
  english: "KURA_DISCORD_WEBHOOK_ENGLISH",
  briefing: "KURA_DISCORD_WEBHOOK_BRIEFING",
};

type PublishPolicy = { enabled: PublishFeature[] };

export function publishPolicyPath(env: Environment = process.env): string {
  const configHome = env.XDG_CONFIG_HOME || `${env.HOME ?? ""}/.config`;
  if (!configHome || configHome === "/.config") throw new Error("HOME is required");
  return `${configHome}/kura/publish.json`;
}

function isPublishFeature(value: unknown): value is PublishFeature {
  return typeof value === "string" && PUBLISH_FEATURES.includes(value as PublishFeature);
}

function loadPolicy(env: Environment): PublishPolicy {
  const path = publishPolicyPath(env);
  if (!existsSync(path)) return { enabled: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    throw new Error(`cannot parse ${path}: ${error}`);
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !Array.isArray((parsed as { enabled?: unknown }).enabled) ||
    !(parsed as { enabled: unknown[] }).enabled.every(isPublishFeature)
  ) {
    throw new Error(`invalid publish policy: ${path}`);
  }
  return {
    enabled: PUBLISH_FEATURES.filter((feature) =>
      (parsed as { enabled: PublishFeature[] }).enabled.includes(feature),
    ),
  };
}

export function isPublishEnabled(
  feature: PublishFeature,
  env: Environment = process.env,
): boolean {
  return loadPolicy(env).enabled.includes(feature);
}

export function setPublishEnabled(
  features: readonly PublishFeature[],
  enabled: boolean,
  env: Environment = process.env,
): void {
  const path = publishPolicyPath(env);
  if (!enabled && !existsSync(path)) return;

  const current = new Set(loadPolicy(env).enabled);
  for (const feature of features) {
    if (enabled) current.add(feature);
    else current.delete(feature);
  }
  const policy: PublishPolicy = {
    enabled: PUBLISH_FEATURES.filter((feature) => current.has(feature)),
  };

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    chmodSync(dirname(path), 0o700);
  } catch {
    /* filesystem may not support POSIX permissions */
  }
  const temp = `${path}.kura-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    /* filesystem may not support POSIX permissions */
  }
}
