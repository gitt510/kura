#!/usr/bin/env bun
// insert.ts — per-hour decisions の writer (decisions.db への UPSERT)。
//
// orchestrator (hourly-job) が insertDecisions() を import して使う。CLI でも叩ける（手動）。
//   generated = { packs: [ { cwd, intent, decisions: [ Decision ] } ] }  ← LLM (decisions skill) が生成
//   packs 省略 / 空 = 意思決定の無い hour。
//
// meta (window) と cwd 一覧は LLM を信用せず history DB から引き直す。
// window に存在しない cwd の pack は捨てる（LLM が path を発明しても DB に入らない）。
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
import { openDecisionsDb, upsertDecisionsEntry, type Decision } from "./db.ts";

export interface DecisionPack {
  cwd?: string;
  intent?: string | null;
  decisions?: Decision[] | null;
}

export interface DecisionsGenerated {
  packs?: DecisionPack[] | null;
}

const DECISION_STATUSES = new Set<Decision["status"]>([
  "directed",
  "discussed",
  "agent-initiated",
]);

export function parseDecisionsGenerated(value: unknown): DecisionsGenerated {
  const root = expectJsonObject(value, "decisions");
  if (root.packs === undefined) return {};
  if (root.packs === null) return { packs: null };

  const packs = expectJsonArray(root.packs, "decisions.packs").map((value, packIndex) => {
    const pack = expectJsonObject(value, `decisions.packs[${packIndex}]`);
    const cwd = expectJsonString(pack.cwd, `decisions.packs[${packIndex}].cwd`);
    if (
      pack.intent !== undefined &&
      pack.intent !== null &&
      typeof pack.intent !== "string"
    ) {
      throw new Error(`decisions.packs[${packIndex}].intent must be a string or null`);
    }

    let parsedDecisions: Decision[] | null | undefined;
    if (pack.decisions === null) {
      parsedDecisions = null;
    } else if (pack.decisions !== undefined) {
      parsedDecisions = expectJsonArray(
        pack.decisions,
        `decisions.packs[${packIndex}].decisions`,
      ).map((value, decisionIndex) => {
        const path = `decisions.packs[${packIndex}].decisions[${decisionIndex}]`;
        const decision = expectJsonObject(value, path);
        const status = expectJsonString(decision.status, `${path}.status`);
        if (!DECISION_STATUSES.has(status as Decision["status"])) {
          throw new Error(
            `${path}.status must be directed, discussed, or agent-initiated`,
          );
        }
        const parsed: Decision = {
          title: expectJsonString(decision.title, `${path}.title`),
          status: status as Decision["status"],
          touches: expectJsonArray(decision.touches, `${path}.touches`).map(
            (touch, touchIndex) =>
              expectJsonString(touch, `${path}.touches[${touchIndex}]`),
          ),
          body: expectJsonString(decision.body, `${path}.body`),
        };
        for (const key of [
          "statusNote",
          "consideredRejected",
          "risk",
          "reviewerAttention",
        ] as const) {
          if (decision[key] !== undefined) {
            parsed[key] = expectJsonString(decision[key], `${path}.${key}`);
          }
        }
        return parsed;
      });
    }

    return {
      cwd,
      intent: pack.intent as string | null | undefined,
      decisions: parsedDecisions,
    };
  });
  return { packs };
}

const str = (v: string | null | undefined): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

// generated (LLM 出力) を decisions.db に UPSERT する。meta は history DB から引き直す。
// UPSERT した pack 数を返す。
export function insertDecisions(
  target: HourTarget,
  generated: DecisionsGenerated,
  gen: Provenance,
): number {
  const { meta } = getHourWindow(target.date, target.hour);
  const knownCwds = new Set(meta.cwds);
  const db = openDecisionsDb();
  let upserted = 0;
  try {
    for (const pack of generated.packs ?? []) {
      if (!pack?.cwd || !knownCwds.has(pack.cwd)) continue; // window に無い cwd は捨てる
      upsertDecisionsEntry(db, {
        window_start: meta.window_start,
        window_end: meta.window_end,
        date: meta.date,
        cwd: pack.cwd,
        intent: str(pack.intent),
        decisions: jsonArrayOrNull(pack.decisions),
        gen_model: gen.model,
        gen_effort: gen.effort,
      });
      upserted += 1;
    }
  } finally {
    db.close();
  }
  return upserted;
}

if (import.meta.main) {
  const dateArg = process.argv[2];
  const hourArg = process.argv[3];
  if (!dateArg || hourArg === undefined || !/^\d{1,2}$/.test(hourArg)) {
    process.stderr.write("usage: bun insert.ts <YYYY-MM-DD> <hour>  (stdin: packs JSON)\n");
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
  let generated: DecisionsGenerated;
  try {
    generated = parseDecisionsGenerated(stdin.trim() ? JSON.parse(stdin) : {});
  } catch (error) {
    process.stderr.write(`stdin has invalid decisions JSON: ${error}\n`);
    process.exit(1);
  }

  // CLI（in-session の手動実行）では生成 provenance を自己 introspection で取る。
  const n = insertDecisions(target, generated, selfProvenance());
  process.stdout.write(`upserted decisions for ${target.windowStart} (${n} packs)\n`);
}
