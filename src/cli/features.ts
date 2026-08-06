// features.ts — schedule / publish control の CLI adapter。

import { join, resolve } from "node:path";

type FeatureCommand = "schedule" | "publish";

const repo = resolve(import.meta.dir, "../..");

function usage(command: FeatureCommand): number {
  process.stderr.write(
    command === "schedule"
      ? "usage: kura schedule <enable|disable> <timeline|english|decisions|all>\n"
      : "usage: kura publish <enable|disable> <timeline|english|all>\n",
  );
  return 2;
}

export async function runFeatures(
  command: FeatureCommand,
  args: string[],
): Promise<number> {
  const [action, feature, extra] = args;
  if (
    (action !== "enable" && action !== "disable") ||
    feature === undefined ||
    extra !== undefined
  ) {
    return usage(command);
  }

  const script =
    command === "schedule"
      ? join(repo, "src", "launchd", "jobs.ts")
      : join(repo, "src", "publish", "manage.ts");
  const result = Bun.spawnSync([process.execPath, script, feature, action], {
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return result.exitCode ?? 1;
}
