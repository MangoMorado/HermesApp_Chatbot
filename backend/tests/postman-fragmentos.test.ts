import { describe, expect, it } from "vitest";
import { buildPostmanCollection, newmanFolders } from "../scripts/postman/build-collection";
import { FRAGMENTS } from "../scripts/postman/fragments";
import type { PostmanItem } from "../scripts/postman/items";

const collection = buildPostmanCollection(FRAGMENTS);

function requests(item: PostmanItem): PostmanItem[] {
  return item.item ? item.item.flatMap(requests) : [item];
}

function folder(name: string): PostmanItem {
  const found = collection.item.find((item) => item.name === name);
  if (!found) {
    throw new Error(`Sin carpeta ${name}`);
  }
  return found;
}

const scriptOf = (item: PostmanItem, listen: "prerequest" | "test") =>
  (item.event ?? [])
    .filter((e) => e.listen === listen)
    .flatMap((e) => e.script.exec)
    .join("\n");

const FREE_TEXT = new Set(["message", "question", "answer", "reason", "notes"]);

function freeTexts(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(freeTexts);
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, item]) =>
    FREE_TEXT.has(key) && typeof item === "string" ? [item] : freeTexts(item),
  );
}

function parsedBodies(items: readonly PostmanItem[]): unknown[] {
  return items.flatMap((item) => {
    const body = item.request?.body;
    if (body?.mode !== "raw" || body.raw.trim().startsWith("{{")) {
      return [];
    }
    return [JSON.parse(body.raw.replace(/\{\{[^}]+\}\}/g, "x"))];
  });
}

describe("postman: recorridos de Newman", () => {
  it("orden de carpetas", () => {
    expect(collection.item.map((item) => item.name)).toEqual([
      "setup",
      "widget E2E — clinica A",
      "widget E2E — clinica B",
      "fhir — maestros",
      "sim — CRUD",
      "plataforma — clinica newman",
      "panel — clinica A",
      "cleanup",
      "catálogo",
    ]);
    expect(newmanFolders(FRAGMENTS)).not.toContain("catálogo");
  });

  it("cleanup compara los cupos libres con setup", () => {
    const steps = requests(folder("cleanup"));
    const last = steps
      .slice(-2)
      .map((item) => scriptOf(item, "test"))
      .join("\n");
    expect(last).toContain("free_slots_a_before");
    expect(last).toContain("free_slots_b_before");
    expect(
      scriptOf(
        requests(folder("setup")).find((i) => i.name.includes("cupos libres A")) ?? { name: "" },
        "test",
      ),
    ).toContain("free_slots_a_before");
  });

  it("un paso fallido salta a la primera peticion de cleanup", () => {
    const entry = requests(folder("cleanup"))[0]?.name ?? "";
    const widget = requests(folder("widget E2E — clinica A"));
    expect(scriptOf(widget[0] ?? { name: "" }, "test")).toContain(
      `setNextRequest(${JSON.stringify(entry)})`,
    );
    expect(
      requests(folder("cleanup"))
        .map((item) => scriptOf(item, "test"))
        .join("\n"),
    ).not.toContain("setNextRequest");
  });

  it("ningun PUT de maestros toca Patient", () => {
    const puts = requests(folder("fhir — maestros")).filter((i) => i.request?.method === "PUT");
    expect(puts).toHaveLength(4);
    expect(puts.map((item) => item.request?.url.raw).join("\n")).not.toContain("/fhir/Patient");
  });

  it("todo texto libre que se envia lleva newman-", () => {
    const sent = FRAGMENTS.flatMap((fragment) => parsedBodies(fragment.item.flatMap(requests)));
    const texts = sent.flatMap(freeTexts);
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.filter((text) => !text.startsWith("newman-"))).toEqual([]);
  });

  it("los recorridos no usan las operaciones que rompen el laboratorio", () => {
    const urls = FRAGMENTS.flatMap((f) => f.item.flatMap(requests)).map((i) => i.request?.url.raw);
    expect(urls.join("\n")).not.toMatch(/widget-keys\/rotate|\/widget-client/);
  });
});
