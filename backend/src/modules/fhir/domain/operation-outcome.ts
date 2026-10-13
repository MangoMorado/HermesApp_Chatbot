import type { IssueCode, OperationOutcome } from "./resources/types";

export function operationOutcome(code: IssueCode, diagnostics: string): OperationOutcome {
  return {
    resourceType: "OperationOutcome",
    issue: [{ severity: "error", code, diagnostics }],
  };
}
