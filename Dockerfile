# syntax=docker/dockerfile:1

FROM oven/bun:1.3.8-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY shared ./shared
COPY questions.sqlite3 ./questions.sqlite3
COPY scripts/create-seed.ts ./scripts/create-seed.ts

RUN bun run build \
    && bun scripts/create-seed.ts questions.sqlite3 /tmp/questions.seed.sqlite3

FROM oven/bun:1.3.8-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=18002 \
    DATABASE_PATH=/data/questions.sqlite3 \
    SEED_DATABASE_PATH=/app/questions.seed.sqlite3

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production \
    && mkdir -p /data \
    && chown -R bun:bun /app /data

COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --from=build --chown=bun:bun /tmp/questions.seed.sqlite3 ./questions.seed.sqlite3
COPY --chown=bun:bun server ./server
COPY --chown=bun:bun shared ./shared
COPY --chown=bun:bun drizzle ./drizzle
COPY --chown=bun:bun docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod 0555 /usr/local/bin/docker-entrypoint.sh

USER bun
EXPOSE 18002

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:18002/api/health').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["bun", "run", "start"]
