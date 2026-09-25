import type { ReactNode } from "react";

type Props = {
  /** Nombre humano del campo. */
  readonly label: string;
  /** Clave técnica del contrato (segunda capa del rótulo, para QA). */
  readonly apiKey?: string;
  readonly className?: string;
  readonly children: ReactNode;
};

/** Rótulo de dos capas: nombre humano sobre la clave técnica que viaja a la API. */
export function Field({ label, apiKey, className, children }: Props) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: el control llega como children y queda dentro del label
    <label className={className ? `field ${className}` : "field"}>
      <span className="field-label">
        {label}
        {apiKey ? <span className="field-key">{apiKey}</span> : null}
      </span>
      {children}
    </label>
  );
}
