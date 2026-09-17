# Modulos del backend

Un directorio por contexto de negocio. Cada uno con la misma forma:

```
<contexto>/
  domain/         # entidades, value objects, puertos. Sin I/O, sin framework.
  application/    # casos de uso que orquestan el dominio a traves de puertos.
  infrastructure/ # adaptadores: Prisma, HTTP saliente, reloj, IDs.
```

Reglas que hace cumplir Biome (`backend/biome.json`) y la suite `fronteras`:

- `domain/` y `application/` no importan `next`, `@prisma/client`, `react` ni `node:*`.
- Las dependencias apuntan hacia adentro: `infrastructure` -> `application` -> `domain`.
- Quien ensambla adaptadores concretos con casos de uso es `src/composition-root.ts`,
  no los route handlers.

Los route handlers de `src/app/` son adaptadores de entrada: validan, autentican,
traducen errores y delegan. No contienen reglas de negocio.
