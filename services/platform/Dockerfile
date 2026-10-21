FROM docker.io/library/node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/platform/package.json services/platform/package.json
COPY services/woocommerce-mcp/package.json services/woocommerce-mcp/package.json
RUN npm ci
COPY services/platform services/platform
RUN npm run build --workspace @urumi/platform \
    && cp services/platform/src/schema.sql services/platform/dist/src/schema.sql \
    && npm prune --omit=dev
FROM docker.io/library/node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/services/platform/package.json ./services/platform/package.json
COPY --from=build --chown=node:node /app/services/platform/dist ./services/platform/dist
USER node
EXPOSE 3000
CMD ["node", "services/platform/dist/src/index.js"]
