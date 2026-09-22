"use client";

type Row = Record<string, unknown>;
export type PageResult = { data?: Row[]; next_cursor?: string | null };

export function idempotent(body: unknown) {
  return {
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": crypto.randomUUID() },
  };
}

export function cell(row: Row, key: string): string {
  return String(row[key] ?? "");
}

export async function runAction(
  setError: (err: unknown) => void,
  action: () => Promise<void>,
): Promise<void> {
  setError(null);
  try {
    await action();
  } catch (err) {
    setError(err);
  }
}
