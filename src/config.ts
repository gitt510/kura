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
const object = (shape: z.ZodRawShape) =>
  z.object(shape, { error: "must be an object" }).prefault({});

// generator / effort の値の妥当性は使う側 (agent/run.ts) が検証する。ここは形だけ。
// avatar は Discord 投稿に出すその agent の画像 URL。
const agent = object({ model: text, effort: text, avatar: text });
const model = (fallback: string) => object({ model: text.transform((value) => value ?? fallback) });
// 配信する feature。webhook は URL か op:// 参照。publish は `kura publish` が書く明示 opt-in。
const published = object({ publish: flag.default(false), webhook: text });

const isWidget = (value: unknown): value is { id: string; share: number } =>
  !!value &&
  typeof value === "object" &&
  typeof (value as { id?: unknown }).id === "string" &&
  (value as { id: string }).id.trim() !== "" &&
  count.safeParse((value as { share?: unknown }).share).success;

// root は「誰のための設定か」で 3 つ: agent (生成に使う CLI)、features (機能ごと)、mod (Claude Code mod)。
const Config = z.object(
  {
    agent: object({
      generator: text.transform((value) => value ?? "claude"),
      claude: agent,
      codex: agent,
    }),
    features: object({
      redpen: model("opus"),
      tldr: model("opus"),
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

// 旧 schema の root key → 新しい置き場所。見つけたら parse せずに案内する。
const MOVED: Record<string, string> = {
  generator: "agent.generator",
  claude: "agent.claude",
  codex: "agent.codex",
  redpen: "features.redpen",
  tldr: "features.tldr",
  companion: "mod.companion",
  discord: "agent.<claude|codex>.avatar and features.<timeline|english>.webhook",
  publish: "features.<timeline|english>.publish",
};

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
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const moved = Object.keys(raw).filter((key) => key in MOVED);
    if (moved.length > 0) {
      const hints = moved.map((key) => `${key} → ${MOVED[key]}`).join(", ");
      throw new Error(`invalid config ${path}: old layout, move ${hints}`);
    }
  }
  const result = Config.safeParse(raw);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue?.path.join(".");
  const reason = issue?.message ?? "is invalid";
  throw new Error(`invalid config ${path}: ${field ? `${field} ${reason}` : reason}`);
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
    const { webhook } = features[name];
    if (webhook && !isSecretReference(webhook))
      features[name] = { ...features[name], webhook: "<redacted>" };
  }
  return { ...config, features };
}
