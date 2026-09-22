#!/bin/sh
# Aplica migraciones pendientes y arranca el servidor. Si la migracion falla,
# el contenedor no arranca: nunca se sirve con un esquema desalineado.
set -e
cd /app/tools
npx prisma migrate deploy
cd /app
exec node server.js
