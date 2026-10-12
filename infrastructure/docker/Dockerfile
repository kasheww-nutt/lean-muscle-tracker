FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DATABASE_PATH=/data/tracker.sqlite MIGRATIONS_PATH=/app/database/migrations
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/frontend/.next ./frontend/.next
COPY --from=build --chown=node:node /app/frontend/public ./frontend/public
COPY --from=build --chown=node:node /app/frontend/next.config.ts ./frontend/next.config.ts
COPY --from=build --chown=node:node /app/database ./database
COPY --from=build --chown=node:node /app/scripts ./scripts
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 5173
CMD ["node", "scripts/start.mjs"]
