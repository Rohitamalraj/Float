# Build progress

Tracks the phased plan in `~/.claude/plans/zazzy-inventing-volcano.md`.

## ✅ Phase 0 — Foundations
- pnpm + Turborepo monorepo scaffold; shared tsconfig / ESLint (flat) / Prettier (+ solidity plugin) / EditorConfig / `.nvmrc`.
- `.env.example` covering every service; `pnpm.onlyBuiltDependencies` allowlist.
- `@float/config`: per-chain address registry (Uniswap permissioned pools mainnet+Sepolia, ENS v2 provisional, USDC, EntryPoint, Permit2), zod env schema with `.env` root discovery, ENS record-key constants, viem client factory. **8 tests.**
- `@float/core`: `evaluateSweep` decision engine (compliance gate → idle sweep-in → obligation-aware sweep-out, caps + dust floor + staleness) and ENS record parse/serialize. **26 tests.**
- Toolchain installed: Foundry 1.8.1 (`~/bin` wrappers), verified Docker 29 / Node 22 / pnpm 10.

## ✅ Phase 1 — Contracts (core; deploy scripts done, fork test pending)
- Foundry project; `v4-periphery@3245c3cb…` + vendored deps; remappings pinned to one OZ (5.0.2).
- Researched the real permissioned-pool internals: `IAllowlistChecker.checkAllowlist`, `PermissionsAdapter` auto-unwrap on `PoolManager.take`, `PermissionedV4Router` pay/settle overrides, Universal Router `V4_SWAP` = `abi.encode(actions, params)`. **Sepolia addresses captured.**
- Contracts (all compile, `forge lint` clean):
  - `FloatComplianceRegistry` — oracle-gated attestations, expiry, revoke.
  - `FloatAllowlistChecker` — `IAllowlistChecker` → registry; LP manager gets `LIQUIDITY_ALLOWED`.
  - `FloatPolicyView` — on-chain buffer / max-sweep mirror (`POLICY_SYNC_ROLE`).
  - `FloatUSTB` — ERC-4626 over USDC; simple-interest accrual from the reserve, Float spread skim, `nonReentrant`, decimals offset 3.
  - `FloatYieldReserve` — Float-funded USDC reserve, vault-only `pull` capped at balance.
  - `FloatSweepExecutor` — the only session-key target; `sweepIn`/`sweepOut` via permissioned Universal Router, per-business verify + cap, immutable, unprivileged.
  - `libraries/FloatSwapEncoder` — `SWAP_EXACT_IN_SINGLE → SETTLE_ALL → TAKE` V4_SWAP encoding.
- **33 Foundry tests pass** (registry, policy view, checker, reserve, USTB yield/spread/dilution, encoder).
- Deploy scripts: `Config.sol`, `DeployCore.s.sol`, `DeployVenue.s.sol` (adapter create → verify → wrappers → pool init → executor → registry-register). Compile; **not yet run against a Sepolia fork.**

### Phase 1 remaining
- [ ] `test/fork/SweepRoundTrip.t.sol` — real Sepolia permissioned contracts, USDC→fUSTB→USDC via the executor + a scripted out-of-policy rejection.
- [ ] `SeedLiquidity.s.sol` — mint the initial pool position via `PermissionedPositionManager`.
- [ ] Verify ENS v2 Sepolia addresses; confirm the Sepolia test-USDC choice.

## ⬜ Phase 2 — Core packages (`db`, `contracts-sdk`, `ens`, `wallet`, `uniswap`)
## ⬜ Phase 3 — agent-service
## ⬜ Phase 4 — gateway
## ⬜ Phase 5 — web (dashboard + admin + API)
## ⬜ Phase 6 — hardening
