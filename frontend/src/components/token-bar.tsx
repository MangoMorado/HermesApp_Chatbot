"use client";

import { useState, useSyncExternalStore } from "react";
import {
  clearToken,
  getTokenPresenceServerSnapshot,
  getTokenPresenceSnapshot,
  setToken,
  subscribeTokenPresence,
} from "@/lib/token";

export function TokenBar() {
  const [draft, setDraft] = useState("");
  const saved = useSyncExternalStore(
    subscribeTokenPresence,
    getTokenPresenceSnapshot,
    getTokenPresenceServerSnapshot,
  );

  return (
    <section className="token-bar">
      <label htmlFor="jwt">
        Token JWT
        <input
          id="jwt"
          type="password"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Pega el token (npm run token:dev en backend)"
        />
      </label>
      <div className="token-actions">
        <button
          type="button"
          onClick={() => {
            setToken(draft.trim());
            setDraft("");
          }}
        >
          Guardar
        </button>
        <button type="button" onClick={() => clearToken()}>
          Borrar
        </button>
        <span className="token-status">{saved ? "Token en sessionStorage" : "Sin token"}</span>
      </div>
    </section>
  );
}
