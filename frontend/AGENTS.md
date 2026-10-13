# AGENTS.md — frontend

Reglas en [`../GOBERNANZA.md`](../GOBERNANZA.md). Aquí solo el mapa.

## Dónde va cada cosa

```
src/app/(console)/   Consola con cabecera: panel, conocimiento, bot, ajustes, /chat, simulador, bandeja.
src/app/(embed)/     Páginas sin cabecera: /widget (para iframe).
src/widget/          Núcleo del chat, compartido por script, iframe y consola. Habla directo al
                     backend por CORS con su propio cliente (src/widget/api, generado).
scripts/             build-widget.mjs (bundle del script) y serve-host.mjs (sitio de prueba).
tests/               Vitest.
```

## La regla que define este proyecto

**Sin reglas de negocio.** El frontend consume el cliente generado desde el OpenAPI del
backend; ese cliente no se edita a mano. Duplicar aquí una validación de negocio es un
defecto, no una mejora de experiencia. La validación de forma (campo requerido, formato de
un correo) sí vive aquí.

Si para pintar algo hace falta una decisión de negocio, esa decisión va en el backend y el
frontend la recibe resuelta.

## Comandos

```bash
npm run dev         # http://localhost:3000
npm test
npm run typecheck
npm run doctor      # React Doctor: su salida es puerta de CI
```

## Antes de terminar

React Doctor tiene que pasar. No se silencia una regla para pasar la puerta: se arregla el
componente.
