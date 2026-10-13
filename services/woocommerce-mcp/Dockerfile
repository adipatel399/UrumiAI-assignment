FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/woocommerce-mcp/package.json services/woocommerce-mcp/package.json
RUN npm ci --workspace @urumi/woocommerce-mcp --include-workspace-root
COPY services/woocommerce-mcp services/woocommerce-mcp
RUN npm run build --workspace @urumi/woocommerce-mcp \
    && npm prune --omit=dev --workspace @urumi/woocommerce-mcp

FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/woocommerce-mcp/package.json ./services/woocommerce-mcp/package.json
COPY --from=build /app/services/woocommerce-mcp/dist ./services/woocommerce-mcp/dist
USER node
EXPOSE 3000
CMD ["node", "services/woocommerce-mcp/dist/src/index.js"]
