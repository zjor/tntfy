FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/tntfy/package.json apps/tntfy/
RUN pnpm install --frozen-lockfile

COPY apps/tntfy/ apps/tntfy/
RUN pnpm turbo build --filter=@tntfy/app

RUN pnpm --filter @tntfy/app deploy --prod --legacy /app/pruned

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_OPTIONS=--disable-warning=DEP0040
COPY --from=build /app/pruned/dist ./dist
COPY --from=build /app/pruned/node_modules ./node_modules
COPY --from=build /app/pruned/package.json ./

EXPOSE 3000
CMD ["node", "dist/main.js"]
