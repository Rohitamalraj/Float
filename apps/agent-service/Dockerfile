# Float agent-service. Build from the repo root:
#   docker build -f apps/agent-service/Dockerfile -t float/agent-service .
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/agent-service ./apps/agent-service
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @float/agent-service... build
RUN pnpm --filter @float/agent-service --prod deploy /out

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /out /app
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
