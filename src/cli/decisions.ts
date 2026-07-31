// decisions.ts — decisions recall の CLI adapter。読み出しのみで状態を変えない。

function usage(): number {
  process.stderr.write("usage: kura decisions [--limit=N] <repo>\n");
  return 2;
}

export async function runDecisions(args: string[]): Promise<number> {
  let limit = 50;
  const positional: string[] = [];
  for (const arg of args) {
    const match = arg.match(/^--limit=(\d+)$/);
    if (match) limit = Number.parseInt(match[1]!, 10);
    else if (arg.startsWith("--")) return usage();
    else positional.push(arg);
  }
  if (positional.length !== 1 || limit < 1 || limit > 200) return usage();

  const { recallDecisions } = await import("../features/decisions/recall.ts");
  process.stdout.write(`${JSON.stringify(recallDecisions(positional[0]!, limit))}\n`);
  return 0;
}
