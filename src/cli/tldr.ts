// tldr.ts — `kura tldr`: stdin の会話 (JSON) の最後の回答を 3 行にして JSON で stdout へ返す。
//
// 保存も表示もしない、生成だけの入口。表示は呼び出し側 (Claude Code の mod など) が持つ。
// 生成失敗も JSON の status で返し、exit code は 0。入力が不正なときだけ exit 2。

export async function runTldr(args: string[]): Promise<number> {
  if (args.length !== 0) {
    process.stderr.write("usage: kura tldr < turns.json\n");
    return 2;
  }
  const { generateTldr, parseTldrInput } = await import("../features/tldr/generate.ts");
  let input;
  try {
    input = parseTldrInput(await Bun.stdin.text());
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const result = await generateTldr(input);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}
