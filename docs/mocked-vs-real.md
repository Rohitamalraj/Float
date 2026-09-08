# What is real vs. stubbed in Float

Float is being built as a complete product. The only parts that are not wired to a
live external counterparty are the two that *have* no live counterparty available
to integrate against. Both sit behind real interfaces with real on-chain plumbing,
and each has a single, well-marked swap-in point.

| Area | Status | Where the seam is |
|---|---|---|
| ERC-4337 smart account + scoped agent session key | **Real** | `packages/wallet` (ZeroDev Kernel v3) |
| ENS v2 subname, resolver, policy/compliance records, role split | **Real** | `packages/ens` |
| Uniswap v4 Permissioned Pool swap path (hook-enforced allowlist) | **Real** | `contracts/`, `packages/uniswap` — integrates the live Sepolia deployment |
| Compliance registry + `IAllowlistChecker` bridge | **Real** | `FloatComplianceRegistry`, `FloatAllowlistChecker` |
| Sweep executor (Layer 1 target) | **Real** | `FloatSweepExecutor` |
| Bazantic x402 `/v1/check` + Recipe | **Real** | `apps/gateway` |
| Dashboard, admin, API, DB, agent service | **Real** | `apps/*` |
| **Yield source** | **Stubbed** | `FloatYieldReserve` |
| **Issuer KYC feed** | **Stubbed** | `IssuerAdapter` in `apps/agent-service` |

## 1. Yield source — `FloatYieldReserve`

`FloatUSTB` is a real ERC-4626 vault over USDC. Its yield is paid, in real USDC, by
`FloatYieldReserve` — a Float-funded on-chain reserve that accrues at a configured
annual rate. The accrual accounting, the share-price mechanics, and Float's spread
skim to the treasury are all production code and fully tested.

What is *not* real: the reserve's USDC comes from Float topping it up, not from
coupon payments on tokenized Treasuries. To wire a live issuer (Superstate,
Securitize, Dowgo, …):

- Replace `FloatUSTB` as the pool's permissioned token with the issuer's token, or
- Point `FloatUSTB.RESERVE` at an adapter that draws real distributions.

`float.allowed-protocols` (ENS) and `FLOAT_PERMISSIONS_ADAPTER_ADDRESS` (env) already
make the pool/adapter swappable by config — no code change to the executor or agent.

## 2. Issuer KYC feed — `IssuerAdapter`

`FloatComplianceRegistry` is the real on-chain source of truth. It is written by the
`COMPLIANCE_ORACLE_ROLE` key, driven by the agent service's oracle worker through an
`IssuerAdapter` interface:

- `ManualAdminAdapter` — a real admin-review queue in the dashboard. Float staff
  approve/revoke a business after checking its KYC docs. **This is the default.**
- `WebhookIssuerAdapter` — a skeleton that ingests an issuer's KYC webhook and maps
  it onto `setAttestation` / `revoke`. Fill in the issuer's payload shape and auth.

Nothing downstream (the hook, the executor, the ENS mirror) knows or cares which
adapter produced an attestation.

## Provisional data to verify on first connect

- **ENS v2 Sepolia contract addresses** in `packages/config/src/chains.ts` are
  captured from docs and marked `UNVERIFIED`. `packages/ens` verifies them against
  live contracts before use.
- **Sepolia test USDC** (`0x1c7D…7238`) — confirm this is the USDC the target
  Permissioned Pool contracts expect, or substitute.
