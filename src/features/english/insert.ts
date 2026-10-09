// insert.ts — per-hour english の writer (english.db への UPSERT)。
//
// orchestrator (hourly-job) が insertEnglish() を import して使う。CLI でも叩ける（手動）。
//   generated = { cards: [ Card ] }  ← LLM (english skill) が生成 (型は db.ts の Card。1 hour 1 枚)
//   cards 省略 / 空 = 意味の薄い hour。
//
// meta (window) は LLM を信用せず history DB から引き直す。
// 生成 provenance (gen) は orchestrator が LLM の model から渡す。
// schema / 型 / DB アクセスは同居の ./db.ts が所有する。

import type { Provenance } from "../../agent/provenance.ts";
import type { HourTarget } from "../../clock.ts";
import { getHourWindow } from "../../history/query.ts";
import {
  expectJsonArray,
  expectJsonObject,
  expectJsonString,
  jsonArrayOrNull,
} from "../../json.ts";
import { type Card, type EnglishEntry, openEnglishDb, upsertEnglishEntry } from "./db.ts";

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
      ja: expectJsonString(card.ja, `english.cards[${index}].ja`),
      phrase: expectJsonString(card.phrase, `english.cards[${index}].phrase`),
      en: expectJsonString(card.en, `english.cards[${index}].en`),
    };
    for (const key of ["syl", "read", "alt"] as const) {
      if (card[key] !== undefined) {
        parsed[key] = expectJsonString(card[key], `english.cards[${index}].${key}`);
      }
    }
    // memo は解説 1〜2 点の配列。string 1 本で来ても配列に正規化して DB の形を揃える。
    if (card.memo !== undefined) {
      const path = `english.cards[${index}].memo`;
      parsed.memo = Array.isArray(card.memo)
        ? expectJsonArray(card.memo, path).map((point, i) =>
            expectJsonString(point, `${path}[${i}]`),
          )
        : [expectJsonString(card.memo, path)];
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
