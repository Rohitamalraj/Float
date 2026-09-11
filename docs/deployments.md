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

### Not yet done

- No business has been provisioned (`float.eth` ENS parent not yet
  registered on this chain, no smart account deployed, no session key
  granted). See `docs/runbook.md` and the onboarding flow in `apps/web`.
- `apps/agent-service`, `apps/gateway`, `apps/web` are not yet running against
  this deployment — needs a root `.env` populated with the addresses above
  plus `DATABASE_URL`/`REDIS_URL` (`infra/docker-compose.yml`).
- Pool liquidity is faucet-sized; real sweeps of any size will see
  meaningful slippage until it's deepened.
