#!/usr/bin/env bun
// insert.ts — per-hour english の writer (english.db への UPSERT)。
//
// orchestrator (hourly-job) が insertEnglish() を import して使う。CLI でも叩ける（手動）。
//   generated = { cards: [ Card ] }  ← LLM (english skill) が生成 (型は db.ts の Card。1 hour 1 枚)
//   cards 省略 / 空 = 意味の薄い hour。
//
// meta (window) は LLM を信用せず history DB から引き直す。
// 生成 provenance (gen) は呼び手が渡す — orchestrator は LLM の model、CLI は selfProvenance()。
// schema / 型 / DB アクセスは同居の ./db.ts が所有する。

import { getHourWindow } from "../../history/query.ts";
import { hourTarget, type HourTarget } from "../../lib/clock.ts";
import {
  expectJsonArray,
  expectJsonObject,
  expectJsonString,
  jsonArrayOrNull,
} from "../../lib/json.ts";
import { selfProvenance, type Provenance } from "../../lib/provenance.ts";
import { openEnglishDb, upsertEnglishEntry, type Card, type EnglishEntry } from "./db.ts";

export interface EnglishGenerated {
  cards?: Card[] | null;
}

export function parseEnglishGenerated(value: unknown): EnglishGenerated {
  const root = expectJsonObject(value, "english");
  if (root.cards === undefined) return {};
  if (root.cards === null) return { cards: null };

  const cards = expectJsonArray(root.cards, "english.cards").map((value, index) => {
    const card = expectJsonObject(value, `english.cards[${index}]`);
    const parsed: Card = {
      kind: expectJsonString(card.kind, `english.cards[${index}].kind`),
      ja: expectJsonString(card.ja, `english.cards[${index}].ja`),
      phrase: expectJsonString(card.phrase, `english.cards[${index}].phrase`),
      en: expectJsonString(card.en, `english.cards[${index}].en`),
    };
    for (const key of ["syl", "read", "memo", "alt"] as const) {
      if (card[key] !== undefined) {
        parsed[key] = expectJsonString(card[key], `english.cards[${index}].${key}`);
      }
    }
    return parsed;
  });
  return { cards };
}

// generated (LLM 出力) を english.db に UPSERT する。meta は history DB から引き直す。
export function insertEnglish(
  target: HourTarget,
  generated: EnglishGenerated,
  gen: Provenance,
): void {
  const { meta } = getHourWindow(target.date, target.hour);
  const row: EnglishEntry = {
    window_start: meta.window_start,
    window_end: meta.window_end,
    date: meta.date,
    cards: jsonArrayOrNull(generated.cards),
    gen_model: gen.model,
    gen_effort: gen.effort,
  };
  const db = openEnglishDb();
  try {
    upsertEnglishEntry(db, row);
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const dateArg = process.argv[2];
  const hourArg = process.argv[3];
  if (!dateArg || hourArg === undefined || !/^\d{1,2}$/.test(hourArg)) {
    process.stderr.write("usage: bun insert.ts <YYYY-MM-DD> <hour>  (stdin: cards JSON)\n");
    process.exit(1);
  }
  let target;
  try {
    target = hourTarget(dateArg, Number.parseInt(hourArg, 10));
  } catch (error) {
    process.stderr.write(`${error}\n`);
    process.exit(1);
  }

  const stdin = await Bun.stdin.text();
  let generated: EnglishGenerated;
  try {
    generated = parseEnglishGenerated(stdin.trim() ? JSON.parse(stdin) : {});
  } catch (error) {
    process.stderr.write(`stdin has invalid english JSON: ${error}\n`);
    process.exit(1);
  }

  // CLI（in-session の手動実行）では生成 provenance を自己 introspection で取る。
  insertEnglish(target, generated, selfProvenance());
  const n = Array.isArray(generated.cards) ? generated.cards.length : 0;
  process.stdout.write(`upserted english for ${target.windowStart} (${n} cards)\n`);
}
