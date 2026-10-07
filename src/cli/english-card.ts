// english-card.ts — english-card feature の CLI adapter。本体は src/features/english-card/card.ts。

export async function runEnglishCard(args: string[]): Promise<number> {
  const { runEnglishCard } = await import("../features/english-card/card.ts");
  return runEnglishCard(args);
}
