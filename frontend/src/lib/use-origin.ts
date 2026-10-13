"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** Origen de la página (`https://host[:puerto]`); vacío al renderizar en el servidor. */
export function useOrigin(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => "",
  );
}
