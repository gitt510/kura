// identity.ts — 生成 provenance を Discord webhook の投稿者表示へ変換する。
//
// username / avatar_url は message ごとに効く。model が無い旧データは feature 固有名、
// avatar が未設定なら webhook 自体の既定 avatar に倒れる。

import { provenanceName } from "../agent/provenance.ts";
import { truncateDiscordText } from "./payload.ts";

export interface DiscordIdentity {
  username: string;
  avatar_url?: string;
}

const USERNAME_LIMIT = 80;

export function discordIdentity(
  model: string | null,
  effort: string | null,
  fallbackUsername: string,
  avatar: string | null,
): DiscordIdentity {
  const username = truncateDiscordText(
    provenanceName(model, effort) ?? fallbackUsername,
    USERNAME_LIMIT,
  );
  return avatar ? { username, avatar_url: avatar } : { username };
}
