// handoff.ts — `kura handoff`: tmux の右に新しい Claude Code を開き、引き継ぎ元の session-id を渡す。
//
// 会話は渡さず id だけを system prompt に置く。新しい session は必要なときだけ `kura show` で読む。
// 最初の指示は user が新しい session に打つ — prompt を渡すと、起動しただけで turn が走る。

export function handoffPrompt(sessionId: string, cwd: string): string {
  return (
    `This session was handed off from Claude Code session ${sessionId} (cwd: ${cwd}). ` +
    `When the user's request depends on that earlier conversation, load it with ` +
    `\`kura show ${sessionId}\`; otherwise do not load it.`
  );
}

export async function runHandoff(args: string[]): Promise<number> {
  const [sessionId] = args;
  if (args.length !== 1 || !sessionId || sessionId.startsWith("-")) {
    process.stderr.write("usage: kura handoff <session-id>\n");
    return 2;
  }
  if (!process.env.TMUX) {
    process.stderr.write("kura handoff: not inside tmux\n");
    return 1;
  }
  const cwd = process.cwd();
  const run = Bun.spawnSync(
    [
      "tmux",
      "split-window",
      "-h",
      "-c",
      cwd,
      "claude",
      "--append-system-prompt",
      handoffPrompt(sessionId, cwd),
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  if (run.exitCode !== 0) {
    const reason = run.stderr.toString().trim() || `exit ${run.exitCode}`;
    process.stderr.write(`kura handoff: ${reason}\n`);
    return 1;
  }
  return 0;
}
