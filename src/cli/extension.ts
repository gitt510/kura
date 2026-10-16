// extension.ts — `kura extension`: extension の実行 (run) と、定期実行 (schedule)・配信 (publish) の切り替え。
//
// extension を起動する入口はここ 1 つ。launchd も mod も手動も `kura extension run <name>` を通るので、
// 引数解釈・config・usage の記録が揃う。

import { join, resolve } from "node:path";
import { runAkapen } from "./akapen.ts";
import { runTldr } from "./tldr.ts";
import { runVerbatim } from "./verbatim.ts";

const repo = resolve(import.meta.dir, "../..");

const RUNNERS: Record<string, (args: string[]) => Promise<number>> = {
  timeline: (args) => runHourly("timeline", args),
  english: (args) => runHourly("english", args),
  akapen: runAkapen,
  tldr: runTldr,
  verbatim: runVerbatim,
};
export const EXTENSIONS = Object.keys(RUNNERS);

const USAGE = `usage: kura extension run <${EXTENSIONS.join("|")}> [args]
       kura extension schedule <enable|disable> <timeline|english|all>
       kura extension publish <enable|disable> <timeline|english|all>
`;

function usage(): number {
  process.stderr.write(USAGE);
  return 2;
}

// 1 hour 分の生成・保存・配信。launchd の定期実行も手動の再実行もここを通る。
async function runHourly(name: "timeline" | "english", args: string[]): Promise<number> {
  const { runHourlyJob } = await import("../extensions/hourly-job.ts");
  const { feature } =
    name === "timeline"
      ? await import("../extensions/timeline/feature.ts")
      : await import("../extensions/english/feature.ts");
  return runHourlyJob(feature, args);
}

export async function runExtension(args: string[]): Promise<number> {
  const [verb, ...rest] = args;
  if (verb === "run") {
    const [name, ...runArgs] = rest;
    const runner = name === undefined ? undefined : RUNNERS[name];
    return runner ? runner(runArgs) : usage();
  }
  if (verb === "schedule" || verb === "publish") {
    const [action, name, extra] = rest;
    if (
      (action !== "enable" && action !== "disable") ||
      name === undefined ||
      extra !== undefined
    ) {
      return usage();
    }
    const script =
      verb === "schedule"
        ? join(repo, "src", "launchd", "jobs.ts")
        : join(repo, "src", "publish", "manage.ts");
    const result = Bun.spawnSync([process.execPath, script, name, action], {
      env: process.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return result.exitCode ?? 1;
  }
  return usage();
}
