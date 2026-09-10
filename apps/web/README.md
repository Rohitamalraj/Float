# @float/web

The Float dashboard, onboarding wizard, and Float admin console. Next.js 16
(App Router) + wagmi + SIWE, backed by `@float/db`.

## Pages

| Route | Who | What |
|---|---|---|
| `/login` | anyone | connect wallet → sign-in with Ethereum (no gas) |
| `/onboarding` | signed-in, no business | 4-step wizard: name → disclosures → accreditation → KYC submit. Creates the `businesses` + `compliance` + `kyc_reviews` rows. |
| `/dashboard` | business owner | buffer, parked value, yield + Float spread, compliance + session-key status, recent sweeps |
| `/settings` | business owner | edit the buffer (owner-signed ENS record write via wallet), manage obligations, revoke the agent session key |
| `/admin` | `ADMIN_ALLOWLIST` / `float_staff` | KYC review queue (approve → the agent service writes the attestation), all businesses, gateway usage |

## API (`/api/*`)

SIWE auth (`/auth/nonce`, `/auth/verify`, `/auth/me`, `/auth/logout`) with a
`jose`-signed httpOnly session cookie. `/business/*` for the owner's data,
`/admin/*` gated by `requireAdmin`. `PATCH /business/policy` returns
owner-signable calldata rather than signing anything server-side.

## Run

```bash
docker compose -f infra/docker-compose.yml up -d && pnpm --filter @float/db migrate
cp .env.example .env       # SESSION_SECRET, ADMIN_ALLOWLIST, NEXT_PUBLIC_CHAIN, FLOAT_* addrs
pnpm --filter @float/web dev
```
