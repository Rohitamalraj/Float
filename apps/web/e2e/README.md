# Playwright E2E — `apps/web`

Full-stack browser tests against a **live** app: real Postgres, real route
handlers, real SIWE signature verification. No mocked API responses. The only
thing simulated is the wallet extension — `fixtures/mock-wallet.ts` installs a
minimal EIP-1193/EIP-6963 provider backed by a local viem account so wagmi's
`injected()` connector can drive a real sign-in without a browser extension.
The private key never leaves the Playwright (Node) process: signing happens
via `context.exposeFunction`, and the page only ever sees the resulting
signature.

Same opt-in shape as `contracts/test/fork/` (gated on live infra rather than
run by default) — not part of `pnpm lint|typecheck|test`.

## Run it

```sh
# once
pnpm --filter @float/web exec playwright install --with-deps chromium

# 1. bring up Postgres (+ Redis, for parity with the rest of the stack)
docker compose -f infra/docker-compose.yml up -d
pnpm db:migrate

# 2. start the app against that database
pnpm --filter @float/web dev   # or `build && start` for a prod-shaped run

# 3. in another shell
pnpm --filter @float/web e2e
```

`PLAYWRIGHT_BASE_URL` overrides the default `http://localhost:3000`.

## What's covered

- `onboarding.spec.ts` — connect → SIWE sign-in → 4-step wizard → dashboard,
  and the unauthenticated-redirect guard on `/dashboard`.

Each run creates a new business (`e2e-<timestamp>.float.eth`) — safe to run
repeatedly against the same database.
