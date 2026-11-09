import type { Fragment } from "../items";
import { cleanupFragment } from "./cleanup";
import { fhirMastersFragment } from "./fhir-masters";
import { panelFragment } from "./panel";
import { platformFragment } from "./platform";
import { setupFragment } from "./setup";
import { simCrudFragment } from "./sim-crud";
import { widgetFragment } from "./widget-e2e";

/** Recorridos que ejecuta Newman, en orden (spec 5.3 §4.1). `cleanup` siempre al final. */
export const FRAGMENTS: readonly Fragment[] = [
  setupFragment,
  widgetFragment("a"),
  widgetFragment("b"),
  fhirMastersFragment,
  simCrudFragment,
  platformFragment,
  panelFragment,
  cleanupFragment,
];
