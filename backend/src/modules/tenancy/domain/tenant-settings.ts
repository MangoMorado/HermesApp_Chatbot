import { ValidationError } from "@/modules/shared/domain/validation-error";

export const MIN_QUERY_RANGE_DAYS = 1;
export const MAX_QUERY_RANGE_DAYS = 366;
export const DEFAULT_QUERY_RANGE_DAYS = 31;

/** Ajustes que cada tenant administra. Hoy: tope de dias por consulta de agenda. */
export type TenantSettings = {
  readonly maxQueryRangeDays: number;
};

export function validateTenantSettings(input: TenantSettings): TenantSettings {
  const days = input.maxQueryRangeDays;
  if (!Number.isInteger(days) || days < MIN_QUERY_RANGE_DAYS || days > MAX_QUERY_RANGE_DAYS) {
    throw new ValidationError(
      `max_query_range_days debe ser un entero entre ${MIN_QUERY_RANGE_DAYS} y ${MAX_QUERY_RANGE_DAYS}`,
      { field: "max_query_range_days", min: MIN_QUERY_RANGE_DAYS, max: MAX_QUERY_RANGE_DAYS },
    );
  }
  return { maxQueryRangeDays: days };
}
