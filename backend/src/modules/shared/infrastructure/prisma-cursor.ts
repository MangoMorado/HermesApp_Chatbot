import { decodeCursor, type Page, toPage } from "@/modules/shared/domain/pagination";

/** Condicion Prisma para cursor (clave ASC, id ASC) tras el ultimo elemento. */
export function afterCursorAsc(
  cursor: string | null | undefined,
): { OR: Array<Record<string, unknown>> } | Record<string, never> {
  if (!cursor) {
    return {};
  }
  const position = decodeCursor(cursor);
  return {
    OR: [
      { startAt: { gt: new Date(position.key) } },
      { startAt: new Date(position.key), id: { gt: position.id } },
    ],
  };
}

/** Condicion Prisma para cursor (clave DESC, id DESC). */
export function afterCursorDesc(
  cursor: string | null | undefined,
): { OR: Array<Record<string, unknown>> } | Record<string, never> {
  if (!cursor) {
    return {};
  }
  const position = decodeCursor(cursor);
  return {
    OR: [
      { startAt: { lt: new Date(position.key) } },
      { startAt: new Date(position.key), id: { lt: position.id } },
    ],
  };
}

export function pageByStartAtAsc<T extends { startAt: Date; id: string }>(
  rows: T[],
  limit: number,
): Page<T> {
  return toPage(rows, limit, (row) => ({ key: row.startAt.toISOString(), id: row.id }));
}

export function pageByIdAsc<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  return toPage(rows, limit, (row) => ({ key: row.id, id: row.id }));
}

export function afterIdCursor(cursor: string | null | undefined): { id?: { gt: string } } {
  if (!cursor) {
    return {};
  }
  const position = decodeCursor(cursor);
  return { id: { gt: position.id } };
}
