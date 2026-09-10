# Float gateway. Build from the repo root:
#   docker build -f apps/gateway/Dockerfile -t float/gateway .
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/gateway ./apps/gateway
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @float/gateway... build
RUN pnpm --filter @float/gateway --prod deploy /out

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /out /app
USER node
EXPOSE 8402
CMD ["node", "dist/index.js"]
