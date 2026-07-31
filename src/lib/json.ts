export function jsonArrayOrNull(value: unknown[] | null | undefined): string | null {
  return Array.isArray(value) && value.length > 0 ? JSON.stringify(value) : null;
}

export function parseJsonArray<T>(value: string | null): T[] {
  try {
    return value ? (JSON.parse(value) as T[]) : [];
  } catch {
    return [];
  }
}

export function expectJsonObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function expectJsonArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

export function expectJsonString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
  return value;
}
