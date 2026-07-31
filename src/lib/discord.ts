import { envFilePath, resolveEnv } from "./config.ts";

export async function postDiscord(envName: string, payload: unknown): Promise<number> {
  const webhook = resolveEnv(envName);
  if (!webhook) {
    throw new Error(`${envName} is unset (checked process env and ${envFilePath()})`);
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
