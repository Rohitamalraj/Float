# @float/agent-service

The always-on service that runs Float for every managed business: watch for
payments, decide sweeps, sign and submit them, and keep the compliance +
policy state in sync on-chain.

## Pieces

| Component | Job |
|---|---|
| `watchers/balance-watcher` | subscribes to USDC `Transfer`s into every managed smart account → enqueues `evaluate`; also a slow full re-evaluation tick |
| `workers/evaluate` | assembles the `SweepContext` (chain + ENS + DB), runs `@float/core` `evaluateSweep`, enqueues an idempotent `execute` if it decided to act |
| `workers/execute` | quotes `minOut`, builds the `[approve, sweep]` batch, restores the session-key Kernel client, submits the UserOperation, records `sweeps` / `onchain_tx` / `audit_log` |
| `workers/oracle-sync` | drains the admin-approved KYC queue → writes `FloatComplianceRegistry` + mirrors the ENS `float.kyc-*` records (compliance-oracle key) |
| `workers/policy-sync` | keeps `FloatPolicyView` equal to each business's ENS policy records (`POLICY_SYNC_ROLE` key) |
| `health` | `/health` (liveness), `/ready` (readiness + queue depths) |

Queues are BullMQ on Redis; state is Postgres via `@float/db`. Keys are loaded
from env through the `Signer` abstraction in `signers.ts` — the seam for a KMS
move.

## Run

```bash
docker compose -f infra/docker-compose.yml up -d      # postgres + redis
pnpm --filter @float/db migrate
cp .env.example .env                                   # fill RPC, bundler, keys, FLOAT_* addresses
pnpm --filter @float/agent-service build
pnpm --filter @float/agent-service start
```

Requires the Float contracts deployed (`FLOAT_*_ADDRESS`), a ZeroDev bundler
(`ZERODEV_BUNDLER_RPC`), and the three service keys
(`COMPLIANCE_ORACLE_PRIVATE_KEY`, `POLICY_SYNC_PRIVATE_KEY`,
`AGENT_SESSION_SIGNER_PRIVATE_KEY`).
