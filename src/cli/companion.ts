// companion.ts — companion feature の CLI adapter。本体は src/features/companion/run.ts。

export async function runCompanion(args: string[]): Promise<number> {
  const { runCompanion } = await import("../features/companion/run.ts");
  return runCompanion(args);
}
