# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Producto de dos caras con el mismo peso:

1. **Paciente / visitante del widget de chat** — en el sitio o canal del tenant, necesita agendar, reprogramar, cancelar o consultar información clínica/administrativa sin operador humano.
2. **Operador y admin del panel** — personal de la clínica o plataforma que revisa bandeja de solicitudes, ajusta configuración del tenant, gestiona base de conocimiento y (más adelante) tickets de handoff.

Audiencia técnica secundaria (no primaria de UX): el rol `service` (Hermes / simulador) via FHIR; el simulador se apaga en producción.

## Product Purpose

**Chatbot Ingenius 360** es un chatbot determinista de agenda clínica multi-tenant. Sustituye la dependencia de un LLM por una máquina de estados cuyas respuestas salen de la configuración del tenant, su base de conocimiento y los datos de dominio.

Éxito del MVP: un paciente completa identificación → verificación o pre-registro → solicitud de agenda (o consulta / asesor) de punta a punta; el operador puede tramitar solicitudes; Hermes confirma citas por FHIR; sin fugas clínicas ni IA en el stack.

## Positioning

Máquina de estados **sin IA** integrada con **Hermes como única fuente de verdad** de citas en firme. El servicio solo origina solicitudes y pre-registros (apartado tentativo atómico); nunca confirma ni modifica una cita por sí mismo. Eso lo diferencia de bots clínicos genéricos con LLM y de agendas que escriben citas locales sin pasar por el HIS.

## Operating Context

- Monorepo `backend/` + `frontend/` (Next.js App Router, Prisma, Postgres); UI en español, código en inglés.
- Superficies HTTP: REST `/api/v1` (widget, panel, chat) y FHIR R4 `/fhir` (Hermes).
- Roles JWT: `widget` · `operator` · `admin` · `service`. Tenant solo del claim.
- Hoy (Fase 3 cerrada): panel de lectura y ajustes, base de conocimiento, configuración del bot, simulador CRUD con bandeja, y chat como widget (script, iframe y consola). Tokens de panel emitidos por `/api/platform/v1` y pegados en la franja de sesión; con tests unitarios, suites de BD (`test:db`) y puertas en verde, y el recorrido manual en navegador hecho.
- Arranque local: `npm --prefix frontend run dev` → `http://localhost:3000`; backend en `3001`.
- Despliegue actual: Docker / Easypanel; compose con Postgres.

## Capabilities and Constraints

**Confirmado**

- Sin LLM, embeddings, RAG ni n8n.
- Multitenancy estricto; recurso de otro tenant → `404` (nunca `403`).
- Widget solo chat de su sesión; nunca dominio ni `/fhir`.
- No divulgación: no persistir respuestas de verificación ni datos clínicos en mensajes, auditoría o logs.
- Idempotencia de escrituras con `Idempotency-Key`.
- Chatbot desplegable vs simulador Hermes (apagable en producción); el chatbot no depende de nada del simulador que Hermes no ofrezca por FHIR.
- Roadmap en cinco fases estrictas (`ROADMAP.md`); no abrir una fase sin cerrar la anterior.

**Abiertos / por fase**

- FHIR de escritura y ciclo Hermes completo: Fase 4.
- Rate limits compartidos, handoff-tickets de panel, secretos fuera del compose: Fase 5.

## Brand Commitments

- **Nombre de producto:** Chatbot Ingenius 360. **Marca visual / wordmark:** Ingenius360 (sin espacio).
- **Assets:** `frontend/public/logotipo.png` (logotipo horizontal); `frontend/public/isotipo.png` (isotipo). Uso acordado: logotipo para identidad de marca en UI; isotipo como favicon e icono de app/atalho.
- **Paleta tomada del logo** (muestreo de píxeles opacos; binding para trabajo visual posterior):
  - Primario / wordmark: `#7336F2` · `#8851FA` · `#823CFF`
  - Índigo profundo (gradiente / peso): `#33268D` · `#492DAF` · `#2A1764`
  - Neutros del isotipo: blanco `#FFFFFF` en las barras; contraste alto sobre fondos oscuros
  - Lavandas suaves de anti-alias: `#B8ADE0` · `#C8B0FB` (no usar como acento primario)
- **Tipografía del wordmark:** sans geométrica moderna; «Ingenius» en peso medio/semi-bold y «360» más bold. La UI debe alinearse a esa familia geométrica sans, no a serif ni display ornamentales.
- **Estilo del isotipo:** burbuja de chat circular con tres barras blancas en perspectiva creciente — comunica conversación + progresión; flat, geométrico, alto contraste.
- **Voz de interfaz:** operativa y clara en español (como el resto del producto); sin claims inventados de marketing.

## Evidence on Hand

- Roadmap, gobernanza y README del monorepo.
- Assets de marca en `frontend/public/logotipo.png` e `isotipo.png`.
- Seed multi-tenant y APIs `/api/v1` + `/api/sim/v1` en funcionamiento local/CI.
- **No fabricar:** testimonios, clientes nombrados, benchmarks, pricing ni casos de prensa; no hay demos públicas citables en el repo.

## Product Principles

1. **Determinismo antes que magia** — cada respuesta trazable a config, KB o dominio; cero IA.
2. **Hermes manda la cita** — el chatbot propone; el HIS confirma.
3. **Dos caras, un contrato** — widget y panel son iguales en prioridad; ambos consumen el mismo dominio vía API, sin reglas en el frontend.
4. **Tenant y no divulgación por defecto** — aislamiento y redacción no son opcionales de UX.
5. **Marca Ingenius360 como ancla** — color, tipografía geométrica e isotipo/logotipo fijan la identidad; no sustituirlos por una estética genérica de “salud tech”.
