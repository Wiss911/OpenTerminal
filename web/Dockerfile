FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspace web --include-workspace-root=false --ignore-scripts
COPY web/ web/
RUN npm run build --workspace web

FROM node:24.21.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./web/.next/static
EXPOSE 3000
CMD ["node", "web/server.js"]
