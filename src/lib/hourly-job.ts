// hourly-job.ts — english / timeline 共通の per-hour オーケストレーター。
//
// 決定論的な処理（素材取得・DB 書き込み・配信）は orchestrator が握り、LLM
// 選択した agent の repo-owned skill には「素材 → 生成物 JSON」の生成だけを任せる。
//
//   1. resume     : DB に生成済み row があれば generate / insert を skip
//   2. 素材取得   : 未生成なら getHourWindow で対象 hour の素材を取得
//   3. generate   : LLM が messages.json を読み generated.json を Write（非決定的）
//   4. insert     : generated.json を DB に UPSERT（決定論。provenance は LLM の model）
//   5. publish    : policy が enabled のときだけ DB の row を外部配信
//
// publish 失敗後に同じ hour を再実行すると、保存済み row から publish だけを retry する。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getHourWindow, type HourWindow } from "../history/query.ts";
import { resolveHourArgs, type HourTarget } from "./clock.ts";
import { runSkillJson } from "./agent.ts";
import { runProvenance, type Provenance } from "./provenance.ts";

// publish の結果。skipped は正常系（空生成物・配信済み）で、失敗は throw で表す。
export type PublishResult =
  | { kind: "published"; status: number }
  | { kind: "skipped"; reason: "empty" | "already-published" };

// feature 間の差分だけを注入する interface。T = LLM が生成する JSON の型。
export interface HourlyFeature<T> {
  name: string; // log 名 / tmp path / skill 起動 (`/${name}`) を兼ねる
  isGenerated(windowStart: string): boolean;
  parseGenerated(value: unknown): T;
  // 素材 (messages.json) を差し替える（決定論）。window に feature 固有の材料
  // （例: decisions の knownTitles）を同梱したいときだけ実装する。LLM に DB を触らせない。
  materials?(target: HourTarget, window: HourWindow): unknown;
  // LLM が生成した JSON を DB に UPSERT する（決定論）。gen = 生成 provenance。
  insert(target: HourTarget, generated: T, gen: Provenance): void;
  // 外部配信を持つ feature だけが実装する。enabled は user の明示 opt-in。
  publish?: {
    enabled(): boolean;
    isPublished(windowStart: string): boolean;
    run(target: HourTarget): Promise<PublishResult>;
  };
}

export function hourlyPlan(
  generated: boolean,
  publishEnabled: boolean,
  published: boolean,
): { generate: boolean; publish: boolean } {
  return {
    generate: !generated,
    publish: publishEnabled && !published,
  };
}

export async function runHourlyJob<T>(
  feature: HourlyFeature<T>,
  args: string[],
): Promise<number> {
  let target: HourTarget;
  try {
    target = resolveHourArgs(args);
  } catch (error) {
    process.stderr.write(`usage: bun run.ts [<YYYY-MM-DD> <hour 0-23>]\n${error}\n`);
    return 1;
  }

  const tag = `${feature.name} ${target.windowStart}`;
  const generated = feature.isGenerated(target.windowStart);
  const publishEnabled = feature.publish?.enabled() ?? false;
  const published =
    publishEnabled && feature.publish
      ? feature.publish.isPublished(target.windowStart)
      : false;
  const plan = hourlyPlan(generated, publishEnabled, published);

  if (!plan.generate && !plan.publish) {
    const reason = !feature.publish
      ? "already generated"
      : published
        ? "already published"
        : "already generated; publish disabled";
    process.stdout.write(`${tag}: skip (${reason})\n`);
    return 0;
  }

  if (plan.generate) {
    const window = getHourWindow(target.date, target.hour);
    if (window.messages.length === 0) {
      process.stdout.write(`${tag}: skip (empty hour)\n`);
      return 0;
    }

    // LLM には素材（messages）だけ渡し、生成物 JSON を書かせる。DB・配信は触らせない。
    const dir = `/tmp/kura-${feature.name}`;
    const messagesFile = `${dir}/messages.json`;
    const generatedFile = `${dir}/generated.json`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      messagesFile,
      JSON.stringify(feature.materials ? feature.materials(target, window) : window),
    );
    writeFileSync(generatedFile, ""); // 前回の生成物を消す（取り違え防止）

    process.stdout.write(
      `${tag}: ${window.messages.length} prompts / ${window.meta.cwds.length} cwds -> generating\n`,
    );

    let run;
    try {
      run = runSkillJson(feature.name, dir, [target.date, String(target.hour)]);
    } catch (error) {
      process.stderr.write(`${tag}: ${error}\n`);
      return 1;
    }
    if (run.result.trim()) process.stdout.write(`${run.result.trim()}\n`);
    if (!run.ok) {
      if (run.raw) {
        process.stderr.write(`${tag}: agent raw (先頭 500 字): ${run.raw.slice(0, 500)}\n`);
      }
      process.stderr.write(
        `${tag}: ✗ generate failed (exit ${run.exitCode}${run.isError ? ", is_error" : ""})\n`,
      );
      return 1;
    }

    let output: T;
    try {
      const text = readFileSync(generatedFile, "utf-8").trim();
      const value: unknown = text ? JSON.parse(text) : {};
      output = feature.parseGenerated(value);
    } catch (error) {
      process.stderr.write(`${tag}: ✗ generated.json が不正: ${error}\n`);
      return 1;
    }

    try {
      feature.insert(target, output, runProvenance(run.model, run.effort));
    } catch (error) {
      process.stderr.write(`${tag}: ✗ insert failed: ${error}\n`);
      return 1;
    }
  }

  if (!feature.publish) {
    process.stdout.write(`${tag}: ✓ stored\n`);
    return 0;
  }
  if (!publishEnabled) {
    process.stdout.write(`${tag}: ✓ stored (publish disabled)\n`);
    return 0;
  }

  if (!plan.generate) process.stdout.write(`${tag}: generated row found -> publishing\n`);

  let result: PublishResult;
  try {
    result = await feature.publish.run(target);
  } catch (error) {
    process.stderr.write(`${tag}: ✗ publish failed: ${error}\n`);
    return 1;
  }

  if (result.kind === "skipped") {
    process.stdout.write(`${tag}: skip (${result.reason})\n`);
    return 0;
  }
  process.stdout.write(`${tag}: ✓ published (HTTP ${result.status})\n`);
  return 0;
}
