# Float

**ENS-named, non-custodial treasury wallet for agent-paid businesses.**

A business completes KYC once and gets a smart wallet named after itself
(`rosa-design.float.eth`). It sets one number — a working-capital buffer. From then
on, a narrowly-scoped agent sweeps idle balance above the buffer into a
yield-bearing tokenized-Treasury position through a Uniswap v4 Permissioned Pool,
and sweeps it back before bills come due. The agent can do *only* that, within a
hard per-transaction cap it cannot raise, and can be revoked at any time.

## Monorepo layout

```
contracts/        Foundry — the 6 Float contracts + deploy scripts
packages/
  config/         chain addresses, env schema, ENS record keys
  core/           evaluateSweep decision engine (shared)
  db/             Drizzle schema + migrations
  contracts-sdk/  ABIs + typed viem clients
  ens/            ENS v2 subname / resolver / policy / compliance
  wallet/         ZeroDev Kernel account + session keys
  uniswap/        permissioned-pool swap calldata
apps/
  agent-service/  watchers + queues + executor + oracle worker
  gateway/        Hono x402 /v1/check service
  web/            Next.js dashboard + admin + API
docs/             architecture · security-model · mocked-vs-real · runbook
infra/            docker-compose + Dockerfiles
```

## Quick start

```bash
pnpm install
cp .env.example .env            # fill in keys + RPC
docker compose -f infra/docker-compose.yml up -d   # postgres + redis
pnpm --filter @float/db migrate

pnpm contracts:build && pnpm contracts:test
pnpm build && pnpm test
```

## Deploy the on-chain stack (Sepolia)

```bash
cd contracts
forge script script/DeployCore.s.sol  --rpc-url sepolia --broadcast
forge script script/DeployVenue.s.sol --rpc-url sepolia --broadcast
# addresses land in contracts/deployments/<chainId>.{core,venue}.json
```

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — components and data flow
- [`docs/security-model.md`](docs/security-model.md) — the Layer 1 / Layer 2 split
- [`docs/mocked-vs-real.md`](docs/mocked-vs-real.md) — the two external seams
