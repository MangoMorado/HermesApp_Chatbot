# syntax=docker/dockerfile:1

FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:26-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholder solo para `prisma generate` en build; el valor real llega por entorno en runtime.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=public
RUN npx prisma generate && npm run build

# Herramientas de operacion: CLI de Prisma para migrar y tsx para el seed.
FROM node:26-alpine AS tools
RUN apk add --no-cache openssl
WORKDIR /app/tools
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src/config ./src/config
COPY src/modules/shared/infrastructure/prisma-client.ts ./src/modules/shared/infrastructure/prisma-client.ts
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=public
RUN npx prisma generate

FROM node:26-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
# server.js escucha en HOSTNAME; sin esto usa el del contenedor y queda atado a una sola red.
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=tools --chown=nextjs:nodejs /app/tools ./tools
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh
USER nextjs
EXPOSE 3001
CMD ["sh", "/app/entrypoint.sh"]
