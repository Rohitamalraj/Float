# Float architecture

## The one idea

`mybiz.eth` (an ENS v2 subname Float provisions under `float.eth`) resolves to the
business's ERC-4337 smart account and carries two groups of text records on its
per-name Permissioned Resolver:

```
mybiz.eth ── resolves to ──▶ Kernel v3 smart account
├── float.buffer-amount        (owner-writable)   ┐
├── float.max-sweep-per-tx     (owner-writable)   ├─ Layer 2 policy
├── float.allowed-protocols    (owner-writable)   │
├── float.target-yield-token   (owner-writable)   ┘
├── float.kyc-status           (oracle-writable)  ┐
├── float.allowlist-id         (oracle-writable)  ├─ compliance attestation
├── float.kyc-verified-at      (oracle-writable)  │
└── float.accreditation        (oracle-writable)  ┘
```

The compliance oracle writes the compliance records **and** `FloatComplianceRegistry`
on chain. `FloatAllowlistChecker` (an `IAllowlistChecker`) reads that registry, so
the Uniswap Permissioned Pool hook and the ENS attestation are the *same* allowlist.

## Components

```
                         ┌──────────────── apps/web (Next.js) ────────────────┐
                         │ SIWE dashboard · onboarding wizard · Float admin   │
                         │ REST route handlers · Postgres (Drizzle) sessions  │
                         └───────────────┬───────────────────────────────────┘
                                         │ provisions / reads
   ┌───────────────┐   grant (owner sig) │        ┌──────────────────────────────┐
   │ business owner │────────────────────┼───────▶│ Kernel v3 smart account       │
   └───────────────┘                     │        │  owner validator (root)       │
                                         │        │  session key (Layer 1 scope)  │
                                         │        └─────────────┬────────────────┘
   ┌──────────────────────── apps/agent-service ───────────┐    │ approve + sweepIn/Out
   │ balanceWatcher · evaluate/execute/oracle/obligation/  │    │ (session key)
   │ fee queues (BullMQ + Redis) · Signer abstraction      │    ▼
   │  - reads ENS policy + compliance (packages/ens)       │  ┌────────────────────┐
   │  - runs evaluateSweep (packages/core)                 │  │ FloatSweepExecutor  │
   │  - builds + signs UserOps (packages/wallet)           │  └─────────┬──────────┘
   │  - writes FloatComplianceRegistry + mirrors ENS       │            │ execute()
   │  - syncs FloatPolicyView (POLICY_SYNC_ROLE)           │            ▼
   └───────────────────────────────────────────────────────┘  permissioned Universal
                                         │                     Router → v4 pool
   ┌──────────── apps/gateway (Hono) ────┴────┐               (PermissionsAdapter +
   │ POST /v1/check  (x402-metered)           │                PermissionedHooks)
   │ GET  /v1/policy/:ens · POST /v1/quote    │                         │
   │ same evaluateSweep · gateway_calls acct  │        FloatAllowlistChecker ◀── reads
   └─────────────────────────────────────────┘        FloatComplianceRegistry
                                                       FloatUSTB (ERC-4626)
                                                        ◀── yield ── FloatYieldReserve
                                                        ── spread ──▶ Float treasury
```

## Packages

| Package | Responsibility |
|---|---|
| `@float/config` | per-chain addresses, env schema (zod), ENS record-key constants, viem client factory |
| `@float/core` | `evaluateSweep` decision engine + ENS record parse/serialize. Shared by agent-service and gateway. |
| `@float/db` | Drizzle schema + migrations |
| `@float/contracts-sdk` | ABIs + typed viem clients for the 6 Float contracts and the Uniswap/ENS reads |
| `@float/ens` | subname provisioning, resolver deploy/attach, `authorizeTextRoles` role split, policy/compliance read+write |
| `@float/wallet` | Kernel account deploy, session-key grant/serialize/deserialize/revoke |
| `@float/uniswap` | Universal Router `execute` calldata, V4Quoter reads for `minOut` |

## Contracts (`contracts/src`)

| Contract | Role |
|---|---|
| `FloatComplianceRegistry` | oracle-gated allowlist source of truth |
| `FloatAllowlistChecker` | `IAllowlistChecker` over the registry; LP manager gets `LIQUIDITY_ALLOWED` |
| `FloatPolicyView` | on-chain mirror of buffer / max-sweep for the executor |
| `FloatSweepExecutor` | the only session-key target; `sweepIn` / `sweepOut`, bounded, immutable |
| `FloatUSTB` | ERC-4626 vault over USDC; yield leg of the pool |
| `FloatYieldReserve` | Float-funded reserve paying FloatUSTB's yield + spread skim |
| `libraries/FloatSwapEncoder` | builds the V4_SWAP command bytes |

See `security-model.md` for the Layer 1 / Layer 2 split and `mocked-vs-real.md` for
the two external seams.
