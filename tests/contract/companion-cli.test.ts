import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "..", "..", "src", "cli.ts");
const fixture = join(import.meta.dir, "..", "fixtures", "claude.jsonl");

function run(args: string[], stateHome: string) {
  return Bun.spawnSync([process.execPath, cli, "companion", ...args], {
    env: { ...process.env, XDG_STATE_HOME: stateHome },
  });
}

test("companion は不明な引数を usage で拒否する", () => {
  const root = mkdtempSync(join(tmpdir(), "kura-companion-usage-"));
  try {
    const result = run(["--bogus"], root);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain(
      "usage: kura companion [--port=N] [--session=<prefix>]",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("history.db が無ければ有効化の案内を出して終了する", () => {
  const root = mkdtempSync(join(tmpdir(), "kura-companion-nodb-"));
  try {
    const result = run([], root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("just history enable claude");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// blocker がこの test process 内に居るため、companion は spawnSync ではなく非同期に
// 起動する — 同期待ちだと blocker が probe に応答できず deadlock する。
test("port が使用中なら案内して終了する", async () => {
  const root = mkdtempSync(join(tmpdir(), "kura-companion-port-"));
  const blocker = Bun.serve({ port: 0, fetch: () => new Response("busy") });
  try {
    // history.db を fixture の Stop payload で用意する (無いと port 到達前に終了する)
    const input = join(root, "hook-input.json");
    writeFileSync(
      input,
      JSON.stringify({
        session_id: "claude-fixture",
        cwd: "/tmp/kura-fixture",
        transcript_path: fixture,
        hook_event_name: "Stop",
      }),
    );
    Bun.spawnSync([process.execPath, cli, "hook", "claude"], {
      stdin: Bun.file(input),
      env: { ...process.env, XDG_STATE_HOME: root },
    });

    const child = Bun.spawn(
      [process.execPath, cli, "companion", `--port=${blocker.port}`],
      {
        env: { ...process.env, XDG_STATE_HOME: root },
        stdout: "ignore",
        stderr: "pipe",
      },
    );
    const exitCode = await Promise.race([
      child.exited,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    if (exitCode === null) child.kill();
    expect(exitCode).toBe(1);
    expect(await new Response(child.stderr).text()).toContain(
      `port ${blocker.port} is in use`,
    );
  } finally {
    blocker.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
});

test("kura --help が companion を載せる", () => {
  const result = Bun.spawnSync([process.execPath, cli, "--help"], { env: process.env });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("kura companion [--port=N] [--session=<prefix>]");
});
