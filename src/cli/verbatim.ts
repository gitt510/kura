// verbatim.ts — `kura extension run verbatim`: stdin の prompt (JSON) を native の英語に写して JSON で stdout へ返す。
//
// 保存も表示もしない、生成だけの入口。表示は呼び出し側 (Claude Code の mod など) が持つ。
// 生成失敗も JSON の status で返し、exit code は 0 — 失敗理由は generateVerbatim が stderr に書く。
// 入力が不正なときだけ exit 2。訳さない入力 (短すぎる・command) の選別と切り詰めは akapen と同じ。

export async function runVerbatim(args: string[]): Promise<number> {
  if (args.length !== 0) {
    process.stderr.write("usage: kura extension run verbatim < prompt.json\n");
    return 2;
  }
  const { clipInput, shouldSkip } = await import("../extensions/akapen/detect.ts");
  const { generateVerbatim, parseVerbatimInput } = await import(
    "../extensions/verbatim/generate.ts"
  );
  let parsed;
  try {
    parsed = parseVerbatimInput(await Bun.stdin.text());
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  if (shouldSkip(parsed.input)) {
    process.stdout.write(`${JSON.stringify({ status: "skipped" })}\n`);
    return 0;
  }
  const { text: input } = clipInput(parsed.input);
  const result = await generateVerbatim({ ...parsed, input });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}
