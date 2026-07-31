// discord-identity.ts — 生成 provenance を Discord webhook の投稿者表示へ変換する。
//
// username / avatar_url は message ごとに効く。model が無い旧データは feature 固有名、
// avatar URL が無い model family は webhook 自体の既定 avatar に倒れる。

import { resolveEnv } from "./config.ts";
import { truncateDiscordText } from "./discord-payload.ts";
import { provenanceName } from "./provenance.ts";

export interface DiscordIdentity {
  username: string;
  avatar_url?: string;
}

const USERNAME_LIMIT = 80;

// model 名の先頭要素を family と見なす ("claude-fable-5" → CLAUDE)。
// env 名に使えない文字を含む model は対象外。
function familyOf(model: string): string | null {
  const head = model.split("-")[0]?.toUpperCase() ?? "";
  return /^[A-Z0-9_]+$/.test(head) ? head : null;
}

function modelAvatar(model: string | null): string | undefined {
  if (!model) return undefined;
  const family = familyOf(model);
  return (family ? resolveEnv(`KURA_DISCORD_AVATAR_${family}`) : null) || undefined;
}

export function discordIdentity(
  model: string | null,
  effort: string | null,
  fallbackUsername: string,
): DiscordIdentity {
  const username = truncateDiscordText(
    provenanceName(model, effort) ?? fallbackUsername,
    USERNAME_LIMIT,
  );
  const avatarUrl = modelAvatar(model);
  return avatarUrl ? { username, avatar_url: avatarUrl } : { username };
}
