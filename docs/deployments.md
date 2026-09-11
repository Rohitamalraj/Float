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

### Not yet done

- **No business is provisioned.** Blocked on two external, account-gated
  prerequisites neither script nor key generation can substitute for:
  - **`float.eth` itself isn't registered on the ENS v2 beta.** Confirmed via
    web research: ENS v2's `.eth` registrar uses a commit-reveal flow paid in
    a stablecoin of the caller's choice (not a permissionless `register()` on
    the raw registry) — `packages/ens` has no `ethRegistrarController` ABI
    for this, and registering Float's own top-level name is meant to be a
    one-time manual action via the ENS beta app (app.ens.domains, Sepolia),
    not something the per-business automation
    (`planBusinessProvisioning`/`planParentSubregistry`) does — that code
    assumes the parent name already exists and only needs its `tokenId`.
  - **No ZeroDev project** — `ZERODEV_PROJECT_ID` / `ZERODEV_BUNDLER_RPC` /
    `ZERODEV_PAYMASTER_RPC` are unset. Deploying a Kernel v3 smart account and
    granting a session key both go through a ZeroDev bundler; this needs a
    (free) account at dashboard.zerodev.app.
- **Bazantic gateway not registered** — needs a bazantic.com account to point
  at the running gateway and load `docs/recipe.bazantic.json`.
- Pool liquidity is faucet-sized; real sweeps of any size will see
  meaningful slippage until it's deepened.
