# Build progress

Tracks the phased plan in `~/.claude/plans/zazzy-inventing-volcano.md`.

## ✅ Phase 0 — Foundations
- pnpm + Turborepo monorepo scaffold; shared tsconfig / ESLint (flat) / Prettier (+ solidity plugin) / EditorConfig / `.nvmrc`.
- `.env.example` covering every service; `pnpm.onlyBuiltDependencies` allowlist.
- `@float/config`: per-chain address registry (Uniswap permissioned pools mainnet+Sepolia, ENS v2 provisional, USDC, EntryPoint, Permit2), zod env schema with `.env` root discovery, ENS record-key constants, viem client factory. **8 tests.**
- `@float/core`: `evaluateSweep` decision engine (compliance gate → idle sweep-in → obligation-aware sweep-out, caps + dust floor + staleness) and ENS record parse/serialize. **26 tests.**
- Toolchain installed: Foundry 1.8.1 (`~/bin` wrappers), verified Docker 29 / Node 22 / pnpm 10.

## ✅ Phase 1 — Contracts + live-integration fork test
- Foundry project; deps are git submodules: `forge-std` v1.16.2, `v4-periphery` `main` @ `dce236d4`
  — the commit the **live Sepolia** Permissioned Pools were built from (the doc's `3245c3cb`
  pin was stale; confirmed by fork test). OZ 5.0.2 (vendored under v4-periphery).
- Researched the real permissioned-pool internals: `IAllowlistChecker.checkAllowlist`, `PermissionsAdapter` auto-unwrap on `PoolManager.take`, `PermissionedV4Router` pay/settle overrides, Universal Router `V4_SWAP` = `abi.encode(actions, params)`. **Sepolia addresses captured.**
- Contracts (all compile, `forge lint` clean):
  - `FloatComplianceRegistry` — oracle-gated attestations, expiry, revoke.
  - `FloatAllowlistChecker` — `IAllowlistChecker` → registry; LP manager gets `LIQUIDITY_ALLOWED`.
  - `FloatPolicyView` — on-chain buffer / max-sweep mirror (`POLICY_SYNC_ROLE`).
  - `FloatUSTB` — ERC-4626 over USDC; simple-interest accrual from the reserve, Float spread skim, `nonReentrant`, decimals offset 3.
  - `FloatYieldReserve` — Float-funded USDC reserve, vault-only `pull` capped at balance.
  - `FloatSweepExecutor` — the only session-key target; `sweepIn`/`sweepOut` via permissioned Universal Router, per-business verify + cap, immutable, unprivileged.
  - `libraries/FloatSwapEncoder` — `SWAP_EXACT_IN_SINGLE → SETTLE_ALL → TAKE` V4_SWAP encoding.
- **33 unit tests** (registry, policy view, checker, reserve, USTB yield/spread/dilution, encoder).
- Deploy scripts: `Config.sol`, `DeployCore.s.sol`, `DeployVenue.s.sol` (adapter create → verify →
  authorize wrappers + hook → pool init → executor → registry-register).
- **`test/fork/` — 6 tests, opt-in via `FORK_TESTS=1`, green against live Sepolia:** the full
  `sweepIn` (USDC→fUSTB through the real permissioned pool, output to the business account, executor
  holds nothing) and `sweepOut` round-trip, plus reverts for over-cap / unverified / revoked / unset
  policy. This validated the `FloatSwapEncoder` V4_SWAP encoding, the Permit2 flow, the
  checker↔hook bridge, and `DeployVenue`'s setup sequence against real contracts.
- USDC confirmed: Sepolia `0x1c7D…7238` (`symbol()=="USDC"`, 6 dp). PoolManager
  `0xE03A…3543` added to `@float/config`.

### Phase 1 remaining (deferred, non-blocking)
- [ ] `SeedLiquidity.s.sol` — a standalone script for real Sepolia pool liquidity (the fork test
      already proves the mint path via `PermissionedPositionManager.modifyLiquidities`).

## ✅ Phase 2 — Core packages
- `@float/db` — 15-table Drizzle schema + client + migration + docker-compose. 10 tests.
- `@float/contracts-sdk` — ABIs (generated from the Foundry build; CI checks freshness), typed
  `getContract` clients, `resolveFloatDeployment` from env, `readAttestation`/`readAccountPolicy`/
  `readVaultValuation`, and the agent `encodeSweepIn/Out` batch + oracle/policy encoders. 7 tests.
- `@float/ens` — verified ENS v2 Sepolia addresses; VerifiableFactory CREATE2 predictor; resolver
  record read/write; `encodeAuthorizeRecordRoleSplit` (owner ↔ oracle text-key split, Float-admin'd
  so neither can revoke the other); `planBusinessProvisioning()` step plan. 19 tests.
- `@float/wallet` — ZeroDev Kernel v3 (EP 0.7). `agentPermissionSpec` / `buildAgentCallPolicy`
  (the Layer 1 `toCallPolicy` V0.0.4: 4 permissions — sweepIn arg0 ≤ cap, sweepOut, USDC.approve
  spender==executor & amount ≤ cap, FloatUSTB.approve spender==executor). `grantAgentSessionKey`
  (owner serialises), `restoreSessionKeyClient` (agent deserialises), `revokeAgentSessionKey`
  (owner uninstalls), `getBusinessAccount` / `businessKernelClient`. 8 tests (policy shape; the
  network fns need a live bundler).
- `@float/uniswap` — `resolveFloatVenue` + `buildFloatPoolKey` (currency sort) + `zeroForOneFor`;
  `quoteSweep` / `quoteSweepMinOut` via the Sepolia V4Quoter lens; `applySlippage`. 5 tests.

viem bumped to `^2.37.6` workspace-wide (ZeroDev peer). `KERNEL_VERSION` added to the env schema.

## ✅ Phase 3 — `@float/agent-service`
The always-on multi-tenant service. BullMQ (Redis) + Postgres (`@float/db`).
- **balance-watcher** — viem `watchEvent` on USDC `Transfer` to every managed smart account →
  enqueues `evaluate`; refreshes the managed set every 60s; slow full re-evaluation tick as a
  safety net.
- **evaluate worker** — `buildSweepContext` (on-chain attestation + balances + vault valuation,
  ENS policy records with a DB-mirror fallback, obligations) → `@float/core` `evaluateSweep` →
  enqueues an idempotent `execute` (`<businessId>:<direction>:<hour>` job id).
- **execute worker** — quote `minOut` (`@float/uniswap`), build the `[approve, sweep]` batch
  (`@float/contracts-sdk`), `restoreSessionKeyClient` (`@float/wallet`), `sendUserOperation` →
  wait receipt → write `sweeps` / `onchain_tx` / `audit_log`. Concurrency-capped, retry/backoff.
- **oracle-sync worker** — drains admin-approved `kyc_reviews` (the `ManualAdminAdapter` issuer
  stand-in) → `FloatComplianceRegistry.setAttestation` + ENS `float.kyc-*` mirror, both
  compliance-oracle-signed.
- **policy-sync worker** — keeps `FloatPolicyView` equal to each business's ENS policy records
  (`POLICY_SYNC_ROLE`).
- `Signer` abstraction (env keys now, KMS seam), pino logging, `/health` + `/ready`, graceful
  shutdown. Dockerfile + README. 6 tests (idempotency key, connection mapping, context mappers);
  the network path needs a live bundler + DB + Redis.

Schema: added `businesses.ens_resolver`, `onchain_tx_kind` gains `sweep`. Env: `POLICY_SYNC_*`,
`EVALUATE_INTERVAL_MS`, `SWEEP_SLIPPAGE_BPS`, `MIN_SWEEP_USDC`, `MAX_COMPLIANCE_AGE_HOURS`,
`EXECUTE_CONCURRENCY`. `SweepDecisionDetail` given an index signature (jsonb-safe).

## ✅ Phase 4 — `@float/gateway` (Bazantic x402)
Hono service; revenue line 2 + the Bazantic prize integration.
- **`POST /v1/check`** (x402-metered, default 0.01 USDC) — `{ ensName, requestedAction?, amount? }`
  → resolves the name (Float DB first, `UniversalResolverV2` fallback), reads the on-chain
  attestation + ENS policy records, and either delegates to `@float/core` `evaluateSweep` (no
  `requestedAction`) or validates a specific proposed sweep against the buffer + obligations +
  per-tx cap. Returns `{ allowed, action, recommendedAmount, reason, compliance, policy }`.
- **`GET /v1/policy/:ensName`** (free) — policy + compliance summary.
- **`src/x402.ts`** — spec-compliant middleware: `402` + `PaymentRequirements`, `X-PAYMENT`
  verify + settle against a facilitator, `X-PAYMENT-RESPONSE`. Modes: `enforce` / `permissive`
  / disabled. Every call → one `gateway_calls` row (caller, amount, x402 tx, allowed, latency).
- `docs/recipe.bazantic.json` — the Recipe chaining resolve → `/v1/check` → permissioned swap.
- `@float/ens` gained `resolveFloatName` (UniversalResolverV2); `@float/config` gained
  `X402_ENABLED` / `X402_MODE` / `X402_NETWORK` and the UniversalResolverV2 Sepolia address.
- Dockerfile + README. 5 tests (price conversion, challenge/permissive/disabled paths).

## ⬜ Phase 5 — web (dashboard + admin + API)
## ⬜ Phase 6 — hardening
