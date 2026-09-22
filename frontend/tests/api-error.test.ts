import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api-fetcher";

describe("ApiClientError", () => {
  it("expone message y request_id del cuerpo", () => {
    const error = new ApiClientError(
      422,
      {
        error: {
          code: "validation_failed",
          message: "limit invalido",
          request_id: "req-1",
        },
      },
      "fallback",
    );
    expect(error.message).toBe("limit invalido");
    expect(error.body?.error.request_id).toBe("req-1");
  });
});
