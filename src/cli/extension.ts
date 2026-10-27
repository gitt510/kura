// extension.ts — `kura extension run`: extension の実行。
//
// extension を起動する入口はここ 1 つ。mod も手動も `kura extension run <name>` を通るので、
// 引数解釈・config・usage の記録が揃う。

import { runAkapen } from "./akapen.ts";
import { runTldr } from "./tldr.ts";
import { runVerbatim } from "./verbatim.ts";

const RUNNERS: Record<string, (args: string[]) => Promise<number>> = {
  akapen: runAkapen,
  tldr: runTldr,
  verbatim: runVerbatim,
};
export const EXTENSIONS = Object.keys(RUNNERS);

const USAGE = `usage: kura extension run <${EXTENSIONS.join("|")}> [args]
`;

function usage(): number {
  process.stderr.write(USAGE);
  return 2;
}

export async function runExtension(args: string[]): Promise<number> {
  const [verb, ...rest] = args;
  if (verb === "run") {
    const [name, ...runArgs] = rest;
    const runner = name === undefined ? undefined : RUNNERS[name];
    return runner ? runner(runArgs) : usage();
  }
  return usage();
}
