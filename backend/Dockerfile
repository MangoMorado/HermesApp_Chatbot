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

# Herramientas de operacion: migraciones, seed y demo (token + datos de prueba).
FROM node:26-alpine AS tools
RUN apk add --no-cache openssl
WORKDIR /app/tools
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY tsconfig.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY scripts/demo.ts ./scripts/demo.ts
COPY src/config ./src/config
COPY src/modules/shared ./src/modules/shared
COPY src/modules/knowledge/domain ./src/modules/knowledge/domain
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
COPY --chown=nextjs:nodejs docker/demo.sh ./demo.sh
RUN chmod +x /app/demo.sh /app/entrypoint.sh
USER nextjs
EXPOSE 3001
CMD ["sh", "/app/entrypoint.sh"]
