import type { ResourceType } from "./profiles";
import type { BundleLink, FhirBundle, FhirResource } from "./resources/types";

export type SearchBundleInput = {
  /** Base absoluta de la superficie, sin barra final: `https://host/fhir`. */
  readonly baseUrl: string;
  readonly type: ResourceType;
  /** Parametros de la peticion original, en orden. */
  readonly filters: readonly (readonly [string, string])[];
  readonly resources: readonly FhirResource[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
};

const CONTROL_PARAMS: readonly string[] = ["_count", "_offset"];

function pageUrl(input: SearchBundleInput, offset: number): string {
  const query = new URLSearchParams();
  for (const [name, value] of input.filters) {
    if (!CONTROL_PARAMS.includes(name)) {
      query.append(name, value);
    }
  }
  query.set("_count", String(input.limit));
  query.set("_offset", String(offset));
  return `${input.baseUrl}/${input.type}?${query.toString()}`;
}

function linksOf(input: SearchBundleInput): BundleLink[] {
  const links: BundleLink[] = [{ relation: "self", url: pageUrl(input, input.offset) }];
  if (input.offset + input.limit < input.total) {
    links.push({ relation: "next", url: pageUrl(input, input.offset + input.limit) });
  }
  if (input.offset > 0) {
    links.push({
      relation: "previous",
      url: pageUrl(input, Math.max(0, input.offset - input.limit)),
    });
  }
  return links;
}

export function searchBundle(input: SearchBundleInput): FhirBundle {
  return {
    resourceType: "Bundle",
    type: "searchset",
    total: input.total,
    link: linksOf(input),
    entry: input.resources.map((resource) => ({
      fullUrl: `${input.baseUrl}/${input.type}/${resource.id}`,
      resource,
      search: { mode: "match" },
    })),
  };
}
