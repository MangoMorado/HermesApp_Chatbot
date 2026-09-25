"use client";

import { useCallback, useState } from "react";

/**
 * Ejecuta acciones de UI de una en una y expone cuál está en curso y el último
 * error, para pintar botones ocupados y la fila de aviso sin repetir try/catch.
 */
export function useAction() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(async (name: string, action: () => Promise<void>) => {
    setPending(name);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setPending(null);
    }
  }, []);

  return { pending, error, run };
}
