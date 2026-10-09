import { configPath, loadConfig } from "./config.ts";
import type { PublishFeature } from "./publish-policy.ts";
import { resolveSecret } from "./secrets.ts";

export async function postDiscord(feature: PublishFeature, payload: unknown): Promise<number> {
  const webhook = resolveSecret(loadConfig().discord.webhooks[feature]);
  if (!webhook) {
    throw new Error(`discord.webhooks.${feature} is unset in ${configPath()}`);
  }

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Discord POST failed: HTTP ${response.status}\n${await response.text()}`);
  }
  return response.status;
}
