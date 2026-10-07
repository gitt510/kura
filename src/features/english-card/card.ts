// card.ts — `kura english-card`: stdin の 1 prompt を 1 card の JSON にして stdout へ返す。
//
// 保存も表示もしない、生成だけの入口。表示は呼び出し側 (Claude Code の mod など) が持つ。
// 生成失敗も JSON の status で返し、exit code は 0 — 失敗理由は generateCard が stderr に書く。

import { clipInput, shouldSkip } from "./detect.ts";
import { generateCard } from "./generate.ts";

export async function runEnglishCard(args: string[]): Promise<number> {
  if (args.length !== 0) {
    process.stderr.write("usage: kura english-card < prompt.txt\n");
    return 2;
  }
  const text = await Bun.stdin.text();
  if (shouldSkip(text)) {
    process.stdout.write(`${JSON.stringify({ status: "skipped" })}\n`);
    return 0;
  }
  const { text: input } = clipInput(text);
  const result = await generateCard({ input, context: null });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}
