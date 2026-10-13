import type { Metadata } from "next";
import { KnowledgeBoard } from "@/components/panel/knowledge-board";

export const metadata: Metadata = { title: "Conocimiento" };

export default function ConocimientoPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Base de conocimiento</h1>
          <p>
            Lo que el bot responde en las consultas generales. Lee operator y admin; solo admin
            crea, edita y borra. El backend valida cada campo.
          </p>
        </div>
      </div>
      <KnowledgeBoard />
    </>
  );
}
