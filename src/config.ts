// config.ts — kura の設定の正本 ~/.config/kura/config.json の読み書き窓口。
//
// 設定は環境変数から読まない — ファイルに書いた値と実際の動きを一致させるため。
// 置き場所だけは XDG 規約 (XDG_CONFIG_HOME) に従う。file が無ければ既定値で動く。
// schema は下の Config 1 つが正本: 型・既定値・検証をここから引く。

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

type Environment = Readonly<Record<string, string | undefined>>;

// 文字列の項目。空白だけは未設定 (null) として扱う。
const text = z
  .string({ error: "must be a string" })
  .nullable()
  .default(null)
  .transform((value) => value?.trim() || null);
const flag = z.boolean({ error: "must be a boolean" });
// 手で書く 1 人用の file なので、知らない key は typo として load 時に拒否する。
const object = (shape: z.ZodRawShape) =>
  z.strictObject(shape, { error: "must be an object" }).prefault({});

// feature ごとの生成設定。agent はその feature を回せる CLI、model / effort は null なら CLI の既定。
// model は書かなければ feature の既定 (akapen / tldr / verbatim は opus)、null と書けば CLI の既定。
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
// 1 hour ごとに生成する feature。skill を回せる CLI ならどちらでもよい。
export type HourlyExtension = "timeline" | "english";
const hourly = object(generationShape(AGENTS, null));

// root は「誰のための設定か」で 2 つ: extensions (kura の上で動く opt-in の機能ごと)、mod (Claude Code mod)。
const Config = z.strictObject(
  {
    extensions: object({
      akapen: prompted("opus"), // 速さより質 — 既定は opus
      tldr: prompted("opus"),
      verbatim: prompted("opus"), // 訳語の自然さが価値 — 既定は opus
      timeline: hourly,
      english: hourly,
    }),
    mod: object({
      // Claude Code の mod (plugin/) の pane。null は Claude Code の既定に任せる。
      // widget の id が mod に実在するかは mod が判定する。
      companion: z
        .strictObject(
          {
            autoOpen: flag.default(false), // session 開始時に pane を開く
            // 上から順に積む widget の id。最大 3 つ。空なら companion は何もしない。
            // akapen / tldr / verbatim の生成はここに載っている間だけ走る。
            widgets: z
              .array(z.string({ error: "must be a list of widget ids" }).min(1), {
                error: "must be a list of widget ids",
              })
              .max(3, { error: "must list at most 3 widgets" })
              .default(["akapen", "tldr"]),
            // widget ごとの高さの取り分。widgets と同じ順・同じ数。合計で割るので和は 1 でなくてよい。
            ratio: z
              .array(
                z
                  .number({ error: "must be a positive number" })
                  .positive({ error: "must be a positive number" }),
                {
                  error: "must be a list of positive numbers",
                },
              )
              .default([0.5, 0.5]),
          },
          { error: "must be an object" },
        )
        .refine((companion) => companion.ratio.length === companion.widgets.length, {
          path: ["ratio"],
          error: "must list one share per widget in mod.companion.widgets",
        })
        .prefault({}),
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

// 前の版にあった key。知らない key として拒否しつつ、今の書き方を添える。
const RETIRED_KEYS: Record<string, string> = {
  features: 'renamed to "extensions"',
  "extensions.timeline.publish": "removed with Discord delivery",
  "extensions.english.publish": "removed with Discord delivery",
  "mod.companion.columns": "removed; the pane size is left to Claude Code",
  "mod.companion.rows": "removed; the pane size is left to Claude Code",
};

// 書かれていない項目は既定値で埋める。型が違う項目は path と項目名を付けて拒否する。
function parseConfig(raw: unknown, path: string): KuraConfig {
  const result = Config.safeParse(raw);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue?.path.join(".");
  const unknown = (key: string) => {
    const retired = RETIRED_KEYS[field ? `${field}.${key}` : key];
    return retired ? `"${key}" (${retired})` : `"${key}"`;
  };
  const reason =
    issue?.code === "unrecognized_keys"
      ? `has unknown key ${issue.keys.map(unknown).join(", ")}`
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

// 0600 で一時 file に書いてから rename する — 途中で落ちても壊れた file を残さない。
// symlink は実体に書く — dotfiles の stow link を普通の file で置き換えない。
export function saveConfig(config: KuraConfig, linkPath: string = configPath()): void {
  const path = lstatSync(linkPath, { throwIfNoEntry: false }) ? realpathSync(linkPath) : linkPath;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.kura-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    /* filesystem may not support POSIX permissions */
  }
}
