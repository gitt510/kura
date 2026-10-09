// publish-policy.ts — external publish の明示 opt-in。config.json の publish.enabled が正本。

import { existsSync } from "node:fs";
import { configPath, loadConfig, saveConfig } from "../config.ts";

export const PUBLISH_FEATURES = ["timeline", "english"] as const;
export type PublishFeature = (typeof PUBLISH_FEATURES)[number];

function isPublishFeature(value: string): value is PublishFeature {
  return PUBLISH_FEATURES.includes(value as PublishFeature);
}

function enabledFeatures(path: string): PublishFeature[] {
  const enabled = loadConfig(path).publish.enabled;
  const unknown = enabled.filter((value) => !isPublishFeature(value));
  if (unknown.length > 0) {
    throw new Error(`invalid config ${path}: unknown publish feature ${unknown.join(", ")}`);
  }
  return PUBLISH_FEATURES.filter((feature) => enabled.includes(feature));
}

export function isPublishEnabled(feature: PublishFeature, path: string = configPath()): boolean {
  return enabledFeatures(path).includes(feature);
}

export function setPublishEnabled(
  features: readonly PublishFeature[],
  enabled: boolean,
  path: string = configPath(),
): void {
  // 無効化は既定どおりなので、config が無ければ作らない。
  if (!enabled && !existsSync(path)) return;

  const current = new Set(enabledFeatures(path));
  for (const feature of features) {
    if (enabled) current.add(feature);
    else current.delete(feature);
  }
  const config = loadConfig(path);
  config.publish.enabled = PUBLISH_FEATURES.filter((feature) => current.has(feature));
  saveConfig(config, path);
}
