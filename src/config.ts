// config.ts — kura の設定の正本 ~/.config/kura/config.json の読み書き窓口。
//
// 設定は環境変数から読まない — ファイルに書いた値と実際の動きを一致させるため。
// 置き場所だけは XDG 規約 (XDG_CONFIG_HOME) に従う。file が無ければ既定値で動く。
// schema は下の Config 1 つが正本: 型・既定値・検証をここから引く。

import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { isSecretReference, writePrivateJson } from "./secrets.ts";

type Environment = Readonly<Record<string, string | undefined>>;

// 文字列の項目。空白だけは未設定 (null) として扱う。
const text = z
  .string({ error: "must be a string" })
  .nullable()
  .default(null)
  .transform((value) => value?.trim() || null);
const count = z
  .int({ error: "must be a positive integer" })
  .positive({ error: "must be a positive integer" });
const flag = z.boolean({ error: "must be a boolean" });
// 手で書く 1 人用の file なので、知らない key は typo として load 時に拒否する。
const object = (shape: z.ZodRawShape) =>
  z.strictObject(shape, { error: "must be an object" }).prefault({});

// feature ごとの生成設定。agent はその feature を回せる CLI、model / effort は null なら CLI の既定。
// model は書かなければ feature の既定 (redpen / tldr は opus)、null と書けば CLI の既定。
// effort の値の妥当性は agent ごとに違うので使う側 (agent/run.ts) が検証する。
const AGENTS = ["claude", "codex"] as const;
export type Agent = (typeof AGENTS)[number];
export type Generation = { agent: Agent; model: string | null; effort: string | null };
const generationShape = (agents: readonly Agent[], model: string | null) => ({
  agent: z
    .enum(agents, { error: `must be ${agents.map((name) => `"${name}"`).join(" or ")}` })
    .default("claude"),
  model: z
    .string({ error: "must be a string" })
    .nullable()
    .default(model)
    .transform((value) => value?.trim() || null),
  effort: text,
});
// prompt 一発の feature は system prompt と出力の契約が Claude 前提なので claude だけ。
const prompted = (model: string | null) => object(generationShape(["claude"], model));
// 配信する feature。publish.enabled は `kura publish` が書く明示 opt-in。
// discord.webhook は URL か op:// 参照、discord.avatar は投稿者アイコンの URL。
const published = object({
  ...generationShape(AGENTS, null),
  publish: object({
    enabled: flag.default(false),
    discord: object({ webhook: text, avatar: text }),
  }),
});

const isWidget = (value: unknown): value is { id: string; share: number } =>
  !!value &&
  typeof value === "object" &&
  Object.keys(value).every((key) => key === "id" || key === "share") &&
  typeof (value as { id?: unknown }).id === "string" &&
  (value as { id: string }).id.trim() !== "" &&
  count.safeParse((value as { share?: unknown }).share).success;

// root は「誰のための設定か」で 2 つ: features (機能ごと)、mod (Claude Code mod)。
const Config = z.strictObject(
  {
    features: object({
      redpen: prompted("opus"), // 速さより質 — 既定は opus
      tldr: prompted("opus"),
      timeline: published,
      english: published,
    }),
    mod: object({
      // Claude Code の mod (plugin/) の pane。null は Claude Code の既定に任せる。
      // widget の id が mod に実在するかは mod が判定する。
      companion: object({
        enabled: flag.default(false), // redpen / tldr を session の始めから生成する。false なら mod の companion は何もしない
        autoOpen: flag.default(false), // session 開始時に pane を開く
        columns: count.nullable().default(null), // 横に dock したときの幅
        rows: count.nullable().default(null), // prompt の上に置いたときの高さ
        // 上から順に積み、高さを share で割る
        widgets: z
          .array(z.unknown())
          .refine((list) => list.every(isWidget), {
            error: "must be an array of {id: string, share: positive integer}",
          })
          .transform((list) => list.map((widget) => ({ id: widget.id, share: widget.share })))
          .default([
            { id: "redpen", share: 4 },
            { id: "tldr", share: 6 },
          ]),
      }),
    }),
  },
  { error: "must be a JSON object" },
);

export type KuraConfig = z.infer<typeof Config>;

export function defaultConfig(): KuraConfig {
  return Config.parse({});
}

function configHome(env: Environment): string {
  const home = env.XDG_CONFIG_HOME || (env.HOME ? `${env.HOME}/.config` : "");
  if (!home) throw new Error("HOME is required");
  return home;
}

export function configPath(env: Environment = process.env): string {
  return `${configHome(env)}/kura/config.json`;
}

// 書かれていない項目は既定値で埋める。型が違う項目は path と項目名を付けて拒否する。
function parseConfig(raw: unknown, path: string): KuraConfig {
  const result = Config.safeParse(raw);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue?.path.join(".");
  const reason =
    issue?.code === "unrecognized_keys"
      ? `has unknown key ${issue.keys.map((key) => `"${key}"`).join(", ")}`
      : (issue?.message ?? "is invalid");
  throw new Error(`invalid config ${path}: ${field ? `${field} ${reason}` : `config ${reason}`}`);
}

export function loadConfig(path: string = configPath()): KuraConfig {
  if (!existsSync(path)) return defaultConfig();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    throw new Error(`cannot parse ${path}: ${error}`);
  }
  return parseConfig(raw, path);
}

export function saveConfig(config: KuraConfig, path: string = configPath()): void {
  writePrivateJson(path, config);
}

export const PUBLISHED_FEATURES = ["timeline", "english"] as const;
export type PublishedFeature = (typeof PUBLISHED_FEATURES)[number];

// 表示用の config。参照でない webhook は実値なので伏せる — 参照 (op://) はそのまま見せる。
export function redactConfig(config: KuraConfig): KuraConfig {
  const features = { ...config.features };
  for (const name of PUBLISHED_FEATURES) {
    const { publish } = features[name];
    const { webhook } = publish.discord;
    if (webhook && !isSecretReference(webhook)) {
      features[name] = {
        ...features[name],
        publish: { ...publish, discord: { ...publish.discord, webhook: "<redacted>" } },
      };
    }
  }
  return { ...config, features };
}
