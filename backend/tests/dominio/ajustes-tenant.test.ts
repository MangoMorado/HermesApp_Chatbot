import { describe, expect, it } from "vitest";
import { ValidationError } from "@/modules/shared/domain/validation-error";
import {
  DEFAULT_QUERY_RANGE_DAYS,
  validateTenantSettings,
} from "@/modules/tenancy/domain/tenant-settings";

describe("dominio: ajustes del tenant", () => {
  it("el tope por defecto es 31 dias", () => {
    expect(DEFAULT_QUERY_RANGE_DAYS).toBe(31);
  });

  it.each([1, 31, 366])("acepta %i dias", (days) => {
    expect(validateTenantSettings({ maxQueryRangeDays: days })).toEqual({
      maxQueryRangeDays: days,
    });
  });

  it.each([0, 367, 1.5, Number.NaN])("rechaza %s dias", (days) => {
    expect(() => validateTenantSettings({ maxQueryRangeDays: days })).toThrow(ValidationError);
  });
});
