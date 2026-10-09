export interface DiscordField {
  name: string;
  value: string;
}

const FIELD_COUNT = 25;
const FIELD_NAME = 256;
const FIELD_VALUE = 1024;
const EMBED_TOTAL = 6000;

export function truncateDiscordText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  if (limit <= 1) return "…".slice(0, limit);
  return `${value.slice(0, limit - 1)}…`;
}

export function fitDiscordFields(
  fields: readonly DiscordField[],
  reservedCharacters = 0,
): DiscordField[] {
  let remaining = Math.max(0, EMBED_TOTAL - reservedCharacters);
  const fitted: DiscordField[] = [];

  for (const field of fields) {
    if (fitted.length >= FIELD_COUNT) break;
    const name = truncateDiscordText(field.name, FIELD_NAME);
    const valueLimit = Math.min(FIELD_VALUE, remaining - name.length);
    if (valueLimit < 1) continue;
    const value = truncateDiscordText(field.value, valueLimit);
    fitted.push({ name, value });
    remaining -= name.length + value.length;
  }

  return fitted;
}
