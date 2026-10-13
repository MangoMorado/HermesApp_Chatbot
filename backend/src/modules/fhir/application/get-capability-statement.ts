import { capabilityStatement } from "../domain/capability-statement";
import { DECLARED_RESOURCES } from "../domain/registry";
import type { CapabilityStatement } from "../domain/resources/types";

export type GetCapabilityStatement = () => CapabilityStatement;

export function createGetCapabilityStatement(): GetCapabilityStatement {
  return () => capabilityStatement(DECLARED_RESOURCES);
}
