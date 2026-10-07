// hourly.ts — `kura timeline` / `kura english`: 1 hour 分の生成・保存・配信を実行する。
// launchd の定期実行も手動の再実行もこの入口を通る。本体は lib/hourly-job.ts。

type HourlyCommand = "timeline" | "english";

export async function runHourly(command: HourlyCommand, args: string[]): Promise<number> {
  const { runHourlyJob } = await import("../lib/hourly-job.ts");
  const { feature } =
    command === "timeline"
      ? await import("../features/timeline/feature.ts")
      : await import("../features/english/feature.ts");
  return runHourlyJob(feature, args);
}
