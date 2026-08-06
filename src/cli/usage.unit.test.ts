import { expect, test } from "bun:test";
import { fitToWidth, truncate } from "./usage.ts";
import type { Row } from "./terminal.ts";

const body: Row[] = [
  ["companion", "claude-haiku-4-5-20251001", "17", "170", "15,982"],
  ["timeline", "gpt-5.6-sol", "1", "110,563", "1,477"],
  ["TOTAL", "-", "18", "110,733", "17,459"],
];

test("上限を超えた文字列だけを省略記号付きで詰める", () => {
  expect(truncate("gpt-5.6-sol", 17)).toBe("gpt-5.6-sol");
  expect(truncate("claude-haiku-4-5-20251001", 17)).toBe("claude-haiku-4-5…");
});

test("端末幅が足りていれば model 名に触らない", () => {
  expect(fitToWidth(body, 106, 120)).toEqual(body);
});

test("端末幅が不明なら詰めない (非 TTY や pipe 出力)", () => {
  expect(fitToWidth(body, 106, undefined)).toEqual(body);
});

test("溢れた分だけ model 列を詰める — 他の列は触らない", () => {
  const fitted = fitToWidth(body, 106, 98);
  expect(fitted[0]).toEqual(["companion", "claude-haiku-4-5…", "17", "170", "15,982"]);
  expect(fitted[1]).toEqual(["timeline", "gpt-5.6-sol", "1", "110,563", "1,477"]);
});

// model 列を 0 にしても収まらない幅は存在する。そこで縮小を止め、
// 数値列を壊してまで幅に合わせにいかない。
test("極端に狭い端末でも下限より短くはしない", () => {
  const fitted = fitToWidth(body, 106, 20);
  expect(fitted[0]![1]).toBe("claude-haik…");
});
