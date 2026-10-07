import { expect, test } from "bun:test";
import { join } from "node:path";

const cli = join(import.meta.dir, "..", "..", "src", "cli.ts");

test("timeline / english は不正な hour 指定を usage で拒否する", () => {
  for (const feature of ["timeline", "english"]) {
    const result = Bun.spawnSync([process.execPath, cli, feature, "2026-10-07"], {
      env: process.env,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(`usage: kura ${feature} [<YYYY-MM-DD> <hour 0-23>]`);
  }
});

test("launchd job は kura の feature subcommand を起動する", async () => {
  for (const feature of ["timeline", "english"]) {
    const plist = await Bun.file(
      join(import.meta.dir, "..", "..", "src", "launchd", `kura.${feature}.plist`),
    ).text();
    expect(plist).toContain(
      `<string>exec "$HOME/.local/share/kura/src/launchd/run.sh" ${feature}</string>`,
    );
  }
});
