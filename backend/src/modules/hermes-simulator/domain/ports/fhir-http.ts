export type FhirHttpResponse = {
  readonly status: number;
  readonly body: unknown;
};

export type FhirHttpRequest = {
  readonly method: "GET" | "PUT";
  readonly path: string;
  readonly token: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
};

/** Transporte HTTP hacia `/fhir`. El simulador no importa el modulo `fhir`. */
export type FhirHttp = {
  request(input: FhirHttpRequest): Promise<FhirHttpResponse>;
};

export type ServiceTokenProvider = {
  issue(tenantId: string): Promise<string>;
};
