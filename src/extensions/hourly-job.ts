// hourly-job.ts — english / timeline 共通の per-hour オーケストレーター。
//
// 決定論的な処理（素材取得・DB 書き込み）は orchestrator が握り、LLM
// 選択した agent の repo-owned skill には「素材 → 生成物 JSON」の生成だけを任せる。
//
//   1. resume     : DB に生成済み row があれば generate / insert を skip
//   2. 素材取得   : 未生成なら getHourWindow で対象 hour の素材を取得
//   3. generate   : LLM が messages.json を読み generated.json を Write（非決定的）
//   4. insert     : generated.json を DB に UPSERT（決定論。provenance は LLM の model）

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { type Provenance, runProvenance } from "../agent/provenance.ts";
import { runSkillJson } from "../agent/run.ts";
import { type HourTarget, resolveHourArgs } from "../clock.ts";
import type { HourlyExtension } from "../config.ts";
import { getHourWindow, type HourWindow } from "../store/query.ts";

// feature 間の差分だけを注入する interface。T = LLM が生成する JSON の型。
export interface HourlyFeature<T> {
  name: HourlyExtension; // log 名 / tmp path / skill 起動 (`/${name}`) / config の extensions.<name> を兼ねる
  isGenerated(windowStart: string): boolean;
  parseGenerated(value: unknown): T;
  // 素材 (messages.json) を差し替える（決定論）。window に feature 固有の材料
  // を同梱したいときだけ実装する。LLM に DB を触らせない。
  materials?(target: HourTarget, window: HourWindow): unknown;
  // LLM が生成した JSON を DB に UPSERT する（決定論）。gen = 生成 provenance。
  insert(target: HourTarget, generated: T, gen: Provenance): void;
}

export async function runHourlyJob<T>(feature: HourlyFeature<T>, args: string[]): Promise<number> {
  let target: HourTarget;
  try {
    target = resolveHourArgs(args);
  } catch (error) {
    process.stderr.write(`usage: kura ${feature.name} [<YYYY-MM-DD> <hour 0-23>]\n${error}\n`);
    return 1;
  }

  const tag = `${feature.name} ${target.windowStart}`;
  if (feature.isGenerated(target.windowStart)) {
    process.stdout.write(`${tag}: skip (already generated)\n`);
    return 0;
  }

  const window = getHourWindow(target.date, target.hour);
  if (window.messages.length === 0) {
    process.stdout.write(`${tag}: skip (empty hour)\n`);
    return 0;
  }

  // LLM には素材（messages）だけ渡し、生成物 JSON を書かせる。DB は触らせない。
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

  process.stdout.write(`${tag}: ✓ stored\n`);
  return 0;
}
