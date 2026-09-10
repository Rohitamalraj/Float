# @float/gateway

Metered access to Float's sweep-decision logic — revenue line 2, and the
Bazantic / x402 integration. A small Hono service.

## Endpoints

| Route | Payment | Purpose |
|---|---|---|
| `POST /v1/check` | **x402** (`X402_PRICE_USDC`, default 0.01 USDC) | `{ ensName, requestedAction?, amount? }` → `{ allowed, action, recommendedAmount, reason, compliance, policy }`. Omit `requestedAction` to get Float's recommendation via the shared `evaluateSweep`; pass it + `amount` to validate a specific proposed sweep. |
| `GET /v1/policy/:ensName` | free | policy + compliance summary |
| `GET /health`, `GET /` | free | liveness + x402 discovery |

It resolves the ENS name from Float's own DB first, then on-chain
(`UniversalResolverV2`) as a fallback, reads the on-chain compliance attestation
and the ENS policy records, and reuses `@float/core` `evaluateSweep`.

## x402

`src/x402.ts` implements the challenge (`402` + `PaymentRequirements`), `X-PAYMENT`
verification and settlement against a facilitator (`X402_FACILITATOR_URL`), and
`X-PAYMENT-RESPONSE`. Modes:

- `X402_MODE=enforce` — reject unpaid calls (production / standalone)
- `X402_MODE=permissive` — log and proceed unpaid (local dev, or when a hosted
  Bazantic gateway already collected payment upstream)
- `X402_ENABLED=false` — bypass entirely

Every call lands one row in `gateway_calls` (caller, amount, x402 tx, allowed,
latency).

## Run

```bash
cp .env.example .env      # FLOAT_* addresses, RPC, X402_RECEIVING_ADDRESS
pnpm --filter @float/gateway build
pnpm --filter @float/gateway start
```

The Bazantic Recipe that chains this endpoint into a swap is
[`../../docs/recipe.bazantic.json`](../../docs/recipe.bazantic.json).
