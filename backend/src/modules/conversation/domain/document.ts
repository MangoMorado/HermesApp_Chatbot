export type DocumentType = "CC" | "TI" | "CE" | "PA" | "RC";

export const DOCUMENT_TYPES: readonly DocumentType[] = ["CC", "TI", "CE", "PA", "RC"];

export function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}
