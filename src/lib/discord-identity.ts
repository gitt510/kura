// discord-identity.ts — 生成 provenance を Discord webhook の投稿者表示へ変換する。
//
// username / avatar_url は message ごとに効く。model が無い旧データは feature 固有名、
// avatar URL が無い model family は webhook 自体の既定 avatar に倒れる。

import { loadConfig } from "./config.ts";
import { truncateDiscordText } from "./discord-payload.ts";
import { provenanceName } from "./provenance.ts";

export interface DiscordIdentity {
  username: string;
  avatar_url?: string;
}

const USERNAME_LIMIT = 80;

type Avatars = Readonly<Record<string, string>>;

// model 名の先頭要素を family と見なす ("claude-fable-5" → claude)。
function familyOf(model: string): string | null {
  const head = model.split("-")[0]?.toLowerCase() ?? "";
  return /^[a-z0-9_]+$/.test(head) ? head : null;
}

function modelAvatar(model: string | null, avatars: Avatars): string | undefined {
  if (!model) return undefined;
  const family = familyOf(model);
  return (family ? avatars[family] : undefined) || undefined;
}

export function discordIdentity(
  model: string | null,
  effort: string | null,
  fallbackUsername: string,
  avatars: Avatars = loadConfig().discord.avatars,
): DiscordIdentity {
  const username = truncateDiscordText(
    provenanceName(model, effort) ?? fallbackUsername,
    USERNAME_LIMIT,
  );
  const avatarUrl = modelAvatar(model, avatars);
  return avatarUrl ? { username, avatar_url: avatarUrl } : { username };
}
