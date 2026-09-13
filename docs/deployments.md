# Live deployments

## Sepolia (chain id 11155111)

Deployed via `contracts/script/{DeployCore,DeployVenue,SeedLiquidity}.s.sol`, in that
order, against the public RPC (`https://ethereum-sepolia-rpc.publicnode.com`).
Raw addresses in `contracts/deployments/11155111.{core,venue}.json`; full
transaction records in `contracts/broadcast/*/11155111/run-latest.json`.

### Contracts

| Contract | Address |
|---|---|
| USDC (Circle Sepolia test token) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| FloatComplianceRegistry | `0x278a022d3574694A2Cf0feC629961436Ad15152d` |
| FloatAllowlistChecker | `0xc21929DDE550dB7FD28E8576f446f04C08af5890` |
| FloatPolicyView | `0x85A35B7dDC8771A34514E18Eb87a0199853A68bD` |
| FloatYieldReserve | `0xB9343d7bAF48104207aB222Ea57e63c2f337d2F1` |
| FloatUSTB | `0x1e4124aBF103097cc6C56C26009140C34469d258` |
| PermissionsAdapter | `0xB6a78942a7e057BEEe2B7558Ab849019e12AbdBC` |
| PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| FloatSweepExecutor | `0x40D916360e09C4f7A03AB6147E7E360271ebC855` |
| FloatUSTB/USDC pool (fee 3000, tick spacing 60) | poolId `0xb5d24ca47a25b5286fe5658bdce176504f0d6222bde3be484f8026af5c238514` |

All verifiable on [Sepolia Etherscan](https://sepolia.etherscan.io).

### Roles

| Role | Address | Notes |
|---|---|---|
| Deployer / `DEFAULT_ADMIN_ROLE` / `Ownable` admin / liquidity manager | `0xaa63e17e261f47dc6c542e7a5C7CafFDDC39248a` | One key wears all three hats for this initial deploy — see `docs/runbook.md` §1 for splitting them out (Safe multisig target). Also the LP that seeded the pool, since `FloatAllowlistChecker` only grants `LIQUIDITY_ALLOWED` to the address it was constructed with. |
| `COMPLIANCE_ORACLE_ROLE` | `0x31BdadeC6F1DA6051B17f2671046c14d62D3Ab1f` | Signed the one attestation verifying `FloatSweepExecutor` as a swapper. |
| `POLICY_SYNC_ROLE` | `0x68DE797D86aaA7BF5ca8F1cFBFDFae338FC88a44` | Not yet exercised — no business provisioned yet. |
| Treasury (spread recipient) | `0x9A6da7956D1a8aF77Eb1097a0Ed1eF3C515B07E2` | Receive-only; no operations performed by this key. |

Private keys for these operational roles live in `contracts/.env` and
`~/.float-deploy-secrets/sepolia-keys.env` (both local-only, gitignored) — not
in this repo. Freshly generated for this deploy; rotate to KMS/multisig before
any real capital is at risk (`docs/runbook.md` §1).

### State after deploy

- `FloatUSTB.totalAssets()` = 10.6 USDC, `totalSupply()` = 10.6e9 shares (share
  price ≈ 1.00) — 1 USDC from the adapter-verification deposit, 9.6 USDC
  deposited to mint the pool's fUSTB leg.
- Pool seeded with one full-range position: 8 USDC / 8,000 fUSTB-equivalent
  (liquidity `252982212`) — small on purpose (faucet-sized), enough to prove
  the pipeline, not production depth. Re-run `SeedLiquidity.s.sol` with a
  larger `SEED_USDC` to deepen it.
- `FloatSweepExecutor` is `isVerified` in `FloatComplianceRegistry`.

### Services — live and validated against this deployment

Postgres + Redis (`infra/docker-compose.yml`) and all three Node services
have been run end-to-end against the addresses above and confirmed healthy:

```sh
docker compose -f infra/docker-compose.yml up -d
pnpm db:migrate
node apps/agent-service/dist/index.js   # :8080 — /health, /ready
node apps/gateway/dist/index.js         # :8402 — /health, /
cd apps/web && next start -p 3000       # :3000 — SIWE login works
```

This run **found and fixed a real bug**: BullMQ rejects `:` in queue names
(`apps/agent-service/src/queues.ts` used `float:evaluate` etc.) — it had
never been exercised against a real Redis before. Fixed to `float-evaluate`
style names; see the `fix(agent-service)` commit.

The root `.env` this run used holds `ENS_PROVISIONER_PRIVATE_KEY` and
`AGENT_SESSION_SIGNER_PRIVATE_KEY` (generated the same way as the deploy
roles — fresh, local-only, gitignored) in addition to the deploy-role keys
reused from `contracts/.env`.

### ENS v2 — `float.eth` (Sepolia beta)

Registered for real via the beta's actual `ETHRegistrar` (commit-reveal,
paid in USDC — the registrar accepts any ERC-20; confirmed live on-chain
`getRegisterPrice("float", 365 days, USDC)` = 8 USDC, 0 premium). No manual
ENS-app step turned out to be needed — see
`contracts/script/RegisterEnsParent.s.sol`.

| Item | Value |
|---|---|
| Name | `float.eth` |
| tokenId (root registry) | `80733931982562367118208411516584939208225537793689152449941908423395975888896` |
| Owner | ENS provisioner `0x574985Cb004d9b29360A566224F46852eA3Bd097` |
| Subregistry (attached) | `0x6Eb7B0dc3d7f330CCA85fCEC52dC6af694DC4f8F` |
| Duration | 1 year from registration |

Attached via `apps/agent-service/src/scripts/register-ens-parent.ts`
(`pnpm --filter @float/agent-service register-ens-parent`, needs
`ENS_PROVISIONER_PRIVATE_KEY` + `ENS_PARENT_TOKEN_ID` — the ETHRegistrar's
`register()` return value). Business onboarding
(`planBusinessProvisioning`, driven by `apps/web`'s onboarding flow) can now
mint real subnames — `<label>.float.eth` — under this subregistry.

### First real business — provisioned and Layer-1-verified end to end

`acme-labs.float.eth` is a real, fully-provisioned business on this
deployment — proof the entire pipeline works, not just its pieces in
isolation:

| Item | Value |
|---|---|
| ENS name | `acme-labs.float.eth` |
| Smart account (ZeroDev Kernel v3) | `0xFfa77d7d281f417b77f5437b034b809e2a49C56F` |
| Compliance | `verified` on-chain (`FloatComplianceRegistry.isVerified` = true) |
| Policy | buffer 2 USDC, max-sweep 5 USDC — mirrored on `FloatPolicyView` |
| Session key | `active`, granted via a real ZeroDev bundler (EntryPoint 0.7) |

Provisioned by `apps/agent-service/src/scripts/provision-test-business.ts`
(`pnpm --filter @float/agent-service provision-test-business -- --label
<name>`, `--resume <label>` to continue a partially-completed run) — it
bootstraps identity the way `apps/web`'s onboarding API would, then performs
the on-chain provisioning that API doesn't yet trigger (ENS subname/resolver,
Kernel account, session-key grant), then lets the *running* agent-service's
oracle-sync/policy-sync workers do their normal job.

**Layer 1 verified against this real business**: `attack:out-of-policy`
(`docs/security-model.md`) run against it — all 9 adversarial UserOperations
rejected by the real ZeroDev `toCallPolicy` validator on a real Sepolia smart
account, zero state change. This is the strongest evidence the project has
that Float's core security claim holds: not a fork test, not a mock — a real
Kernel v3 account, a real bundler, real cryptographic rejection.

### Bugs this run found and fixed

Every one of these was invisible until the pipeline actually ran against
live infrastructure for the first time:

1. **BullMQ rejects `:` in queue names** — `float:evaluate` etc. → renamed to
   `float-evaluate` style (`apps/agent-service/src/queues.ts`).
2. **BullMQ also rejects `:` in custom job ids** — the interval-tick ids in
   `index.ts` and `watchers/balance-watcher.ts` used the same separator;
   renamed the same way.
3. **Worker failures were completely silent** — no code anywhere listened
   for BullMQ's `'failed'`/`'error'` events, so a worker could fail every
   tick, forever, with zero trace in the logs. This is exactly how the
   `policy-sync` failures below went unnoticed for several minutes. Fixed in
   `makeWorker` (`queues.ts`) — every worker now logs `job failed` /
   `worker error` with the reason.
4. **The `POLICY_SYNC_PRIVATE_KEY` operational address had no Sepolia ETH** —
   not a code bug, an operational gap the new failed-job logging (above)
   would have caught immediately instead of a silent multi-minute stall.

### Onboarding gap closed: real businesses now self-provision

The gap flagged above is fixed — `apps/web`'s onboarding flow now results in a
fully working business with zero manual scripts:

- **`apps/agent-service/src/workers/provision.ts`** — a new worker (20s tick)
  watches `businesses.status = 'onboarding' AND smart_account_address IS
  NULL`, computes each one's Kernel v3 smart account address (deterministic
  from the owner's address — no signature needed), and runs the
  provisioner-signed ENS steps (resolver deploy, subname register, addr +
  role-split). Verified live: created a business via a real SIWE + `POST
  /api/business` call and watched it get a smart account + resolver
  automatically within seconds, with the on-chain `addr()` record confirmed
  pointing at the right address — no script run by hand.
- **`apps/web`'s Settings page** — a new "Grant agent access" action. The
  owner picks a cap and signs with their *own connected wallet*
  (`@float/wallet/client`'s `grantAgentSessionKey`, browser-safe — Float never
  touches this key); the result posts to the existing `POST
  /api/business/session-key` route. Verified live end to end against the real
  API: sign in → fetch grant info → grant client-side → persist — `201` with
  `status: "active"`, smart account address matching the provisioning
  worker's prediction exactly.
- This surfaced a real bundling bug: importing anything from `@float/wallet`'s
  root barrel pulled `@float/config`'s `loadEnv()` (`node:fs`) into the
  browser bundle and crashed Turbopack. Fixed by adding a genuine `@float/wallet/client`
  subpath export containing only browser-safe code, and making `runtime` a
  required (not env-defaulted) parameter on the owner-signed functions.

### Not yet done

- **Bazantic gateway not registered** — needs a bazantic.com account to point
  at the running gateway and load `docs/recipe.bazantic.json`.
- Pool liquidity is faucet-sized; real sweeps of any size will see
  meaningful slippage until it's deepened.
- The owner-signed **initial policy** (buffer/cap ENS records) still happens
  via the existing Settings buffer editor after the account is provisioned,
  not during onboarding itself — matches the design (Float never holds the
  owner key, so anything owner-signed happens in the browser).
