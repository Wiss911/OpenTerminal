FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspace server --include-workspace-root=false --ignore-scripts
COPY server/tsconfig.json server/
COPY server/src server/src
RUN npm run build --workspace server

FROM node:24.21.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspace server --include-workspace-root=false --omit=dev --ignore-scripts
# Verify the bundled Linux SQLite binary without reading or creating app data.
RUN node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); if (db.prepare('SELECT 1 AS value').get().value !== 1) process.exit(1); db.close(); console.log('SQLite prebuilt OK:', process.platform, process.arch);"
COPY --from=build /app/server/dist ./server/dist
EXPOSE 4000
CMD ["node", "server/dist/index.js"]
