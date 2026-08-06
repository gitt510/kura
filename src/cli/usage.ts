// usage.ts — usage.db の feature 別集計を表で表示する。読み出しのみで状態を変えない。

import { existsSync } from "node:fs";
import { openUsageDb, usageDbPath, usageSummary } from "../lib/usage.ts";
import { paint, renderTable, type Row } from "./terminal.ts";

function usageError(): number {
  process.stderr.write("usage: kura usage [--days=N]\n");
  return 2;
}

function tokens(value: number | null): string {
  return (value ?? 0).toLocaleString("en-US");
}

function cost(value: number | null): string {
  return value === null ? "-" : value.toFixed(4);
}

const HEADERS = [
  "Feature",
  "Model",
  "Calls",
  "Input",
  "Output",
  "Cache rd",
  "Cache wr",
  "Cost ($)",
] as const;
const MODEL_COLUMN = 1;
const MODEL_MIN_WIDTH = 12;

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// 端末に収まらないときは Model 列だけを詰める。他の列は数値そのもので、
// 削ると読み取れる事実が変わってしまうため。溢れた分だけ縮めるので、
// 幅が足りている端末では model 名は full のまま出る。
export function fitToWidth(body: Row[], plainWidth: number, columns: number | undefined): Row[] {
  const overflow = columns ? plainWidth - columns : 0;
  if (overflow <= 0) return body;
  const longest = Math.max(...body.map((row) => row[MODEL_COLUMN]!.length));
  const max = Math.max(MODEL_MIN_WIDTH, longest - overflow);
  return body.map((row) =>
    row.map((cell, index) => (index === MODEL_COLUMN ? truncate(cell, max) : cell)),
  );
}

export async function runUsage(args: string[]): Promise<number> {
  let days: number | null = null;
  for (const arg of args) {
    const match = arg.match(/^--days=(\d+)$/);
    if (match) days = Number.parseInt(match[1]!, 10);
    else return usageError();
  }
  if (days !== null && days < 1) return usageError();

  // openUsageDb は file を作ってしまうので、未記録はここで判定する。
  if (!existsSync(usageDbPath())) {
    process.stdout.write("no usage recorded yet — LLM calls will appear here after the next run\n");
    return 0;
  }

  const since = days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString();
  const db = openUsageDb();
  let rows;
  try {
    rows = usageSummary(db, since);
  } finally {
    db.close();
  }

  const period = days === null ? "all time" : `last ${days} day${days === 1 ? "" : "s"}`;
  process.stdout.write(`${paint.bold("Usage")}  ${paint.dim(`(${period})`)}\n`);
  if (rows.length === 0) {
    process.stdout.write(`no calls in this period\n`);
    return 0;
  }

  const total = {
    calls: 0,
    input: 0,
    cacheCreation: 0,
    cacheRead: 0,
    output: 0,
    cost: null as number | null,
  };
  const body: Row[] = rows.map((row) => {
    total.calls += row.calls;
    total.input += row.input_tokens ?? 0;
    total.cacheCreation += row.cache_creation_tokens ?? 0;
    total.cacheRead += row.cache_read_tokens ?? 0;
    total.output += row.output_tokens ?? 0;
    if (row.cost_usd !== null) total.cost = (total.cost ?? 0) + row.cost_usd;
    return [
      row.feature,
      row.model ?? "-",
      String(row.calls),
      tokens(row.input_tokens),
      tokens(row.output_tokens),
      tokens(row.cache_read_tokens),
      tokens(row.cache_creation_tokens),
      cost(row.cost_usd),
    ];
  });
  body.push([
    "TOTAL",
    "-",
    String(total.calls),
    tokens(total.input),
    tokens(total.output),
    tokens(total.cacheRead),
    tokens(total.cacheCreation),
    cost(total.cost),
  ]);

  // 幅の判定は色を付けない描画で行う — ANSI escape は表示幅に寄与しないため。
  const plain = renderTable(HEADERS, body);
  const plainWidth = Math.max(...plain.split("\n").map((line) => [...line].length));
  const fitted = fitToWidth(body, plainWidth, process.stdout.columns);

  process.stdout.write(
    `${renderTable(HEADERS, fitted, (cell, _raw, rowIndex) =>
      rowIndex === fitted.length - 1 ? paint.bold(cell) : cell,
    )}\n`,
  );
  return 0;
}
