// policy.ts — external publish の明示 opt-in。config.json の features.<name>.publish が正本。

import { existsSync } from "node:fs";
import { configPath, loadConfig, PUBLISHED_FEATURES, saveConfig } from "../config.ts";

export const PUBLISH_FEATURES = PUBLISHED_FEATURES;
export type PublishFeature = (typeof PUBLISH_FEATURES)[number];

export function isPublishEnabled(feature: PublishFeature, path: string = configPath()): boolean {
  return loadConfig(path).features[feature].publish;
}

export function setPublishEnabled(
  features: readonly PublishFeature[],
  enabled: boolean,
  path: string = configPath(),
): void {
  // 無効化は既定どおりなので、config が無ければ作らない。
  if (!enabled && !existsSync(path)) return;

  const config = loadConfig(path);
  for (const feature of features) config.features[feature].publish = enabled;
  saveConfig(config, path);
}
