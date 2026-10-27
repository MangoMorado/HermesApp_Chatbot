"use client";

import { Field } from "@/components/ui/field";
import type { KnowledgeDraft } from "@/lib/knowledge-draft";
import type { Knowledge } from "./use-knowledge";

function Actions({ kb }: { readonly kb: Knowledge }) {
  const busy = kb.pending !== null;
  return (
    <div className="form-actions">
      <button
        type="submit"
        className="btn btn-primary"
        disabled={busy}
        aria-busy={kb.pending === "save"}
      >
        {kb.picked ? "Guardar" : "Crear"}
      </button>
      {kb.picked ? (
        <>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={kb.reset}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-danger"
            data-armed={kb.armed}
            disabled={busy}
            onClick={() => (kb.armed ? kb.remove() : kb.setArmed(true))}
          >
            {kb.armed ? "Confirmar borrado" : "Borrar"}
          </button>
        </>
      ) : null}
    </div>
  );
}

/** Alta y edición de una entrada. La fila elegida en el tablero se carga aquí. */
export function KnowledgeForm({ kb }: { readonly kb: Knowledge }) {
  const { draft } = kb;
  const set = (patch: Partial<KnowledgeDraft>) => kb.setDraft({ ...draft, ...patch });
  return (
    <form
      className="form-block"
      action={() => {
        void kb.save();
      }}
    >
      <h3>{kb.picked ? "Editar entrada" : "Nueva entrada"}</h3>
      <Field label="Categoría" apiKey="category">
        <input
          className="input"
          required
          maxLength={60}
          value={draft.category}
          onChange={(event) => set({ category: event.target.value })}
        />
      </Field>
      <Field label="Pregunta" apiKey="question">
        <input
          className="input"
          required
          maxLength={200}
          value={draft.question}
          onChange={(event) => set({ question: event.target.value })}
        />
      </Field>
      <Field label="Respuesta" apiKey="answer">
        <textarea
          className="input input-area"
          required
          rows={3}
          maxLength={1000}
          value={draft.answer}
          onChange={(event) => set({ answer: event.target.value })}
        />
      </Field>
      <Field label="Detalle («ver más»)" apiKey="detail">
        <textarea
          className="input input-area"
          rows={4}
          maxLength={4000}
          value={draft.detail}
          onChange={(event) => set({ detail: event.target.value })}
        />
      </Field>
      <Field label="Palabras clave, separadas por comas" apiKey="keywords">
        <input
          className="input"
          value={draft.keywords}
          onChange={(event) => set({ keywords: event.target.value })}
        />
      </Field>
      <Field label="Posición" apiKey="position" className="field-narrow">
        <input
          className="input data"
          type="number"
          inputMode="numeric"
          min={0}
          value={draft.position}
          onChange={(event) => set({ position: event.target.value })}
        />
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(event) => set({ active: event.target.checked })}
        />{" "}
        Activa (el bot la ofrece)
      </label>
      <Actions kb={kb} />
    </form>
  );
}
