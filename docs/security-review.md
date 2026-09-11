# Security review — Phase 6

Internal review of the six Float contracts (access control + reentrancy) and the
system's key-handling posture, ahead of a real Sepolia deployment. Companion to
`docs/security-model.md` (the two-layer design) and `docs/runbook.md` (operational
response). Nothing here is a substitute for an external audit before mainnet.

## Method

Line-by-line read of `contracts/src/*.sol` against two questions per contract:
who can call each state-changing function, and can any external call in this
contract re-enter it in a way that matters. Cross-checked against the 33 unit
tests + 6 live-Sepolia fork tests, and against `forge lint` (`severity =
["high", "med"]`, three findings excluded with a documented reason in
`foundry.toml` — see below).

## Findings

None of the following required a code change; they are the properties the
design relies on, made explicit so a future change doesn't silently break one.

### `FloatSweepExecutor` — the only session-key target

- **Confused-deputy check**: both `sweepIn`/`sweepOut` use `account =
  msg.sender` throughout — the caller can only ever move *its own* funds, and
  swap output only ever returns to `msg.sender`. There is no parameter that
  lets a caller name a different account. A verified account calling on its
  own behalf is the only possible caller shape.
- **Reentrancy**: `nonReentrant` on both entrypoints. `USDC.safeTransferFrom`
  happens before the router call, so even a malicious ERC-20 with
  transfer-hooks (not USDC, but defense in depth) cannot re-enter `sweepIn`
  mid-flight.
- **No admin, no upgradeability, no privileged caller** — the contract has
  zero storage besides immutables set at construction. There is nothing to
  misconfigure post-deploy short of the constructor args, which
  `DeployVenue.s.sol` sources from the already-verified core deployment.
- **Permit2 approval window**: `_authorizeRouter` grants the Universal Router
  an exact, TTL-bounded (600s) Permit2 allowance sized to the swap amount.
  Because the executor holds no standing token balance between calls (funds
  pass straight through in one transaction), a residual approval carries no
  exploitable value even within the TTL.

### `FloatComplianceRegistry`

- `setAttestation` / `revoke` are `onlyRole(COMPLIANCE_ORACLE_ROLE)`; role
  administration is `DEFAULT_ADMIN_ROLE` (Float governance), and the oracle
  role cannot grant itself anything else (OZ `AccessControl`, no
  self-service role admin configured for it). No reentrancy surface — no
  external calls.

### `FloatPolicyView`

- `setPolicy` / `clearPolicy` are `onlyRole(POLICY_SYNC_ROLE)`. Explicitly
  documented as *not* an authorization boundary (`docs/security-model.md`) —
  it only lets the executor reject an obviously stale amount early with a
  clear revert. No reentrancy surface.

### `FloatAllowlistChecker`

- Pure view bridge from `IAllowlistChecker` to the registry; stateless besides
  two immutables. No privileged mutation exists in this contract at all.

### `FloatUSTB`

- `deposit`/`mint`/`withdraw`/`redeem` are permissionless by design (it is the
  holder's own ERC-4626 capital); compliance is enforced upstream, at the
  pool hook and the executor, not here. All four — plus `accrue`,
  `setYieldRateBps`, `setSpreadShareBps` — are `nonReentrant`, and each
  4626 entrypoint calls `_accrue()` (pulls owed yield, skims the spread)
  *before* delegating to the parent OZ implementation, so the share price
  used for the current call's conversion always reflects settled yield —
  no window where a deposit/withdraw sees a stale price.
  `_decimalsOffset() = 3` is the standard OZ inflation-attack mitigation for
  a 6-decimal underlying.
- `setYieldRateBps`/`setSpreadShareBps` are `onlyOwner` (`Ownable2Step`) —
  currently a single Float key. Tracked in the key-custody table below;
  target is a Safe multisig before any real capital is at risk.
- `RateTooHigh`/`SpreadTooHigh` sanity ceilings (50% APR, 100% spread) bound
  operator error, not malice — the owner key is already trusted.

### `FloatYieldReserve`

- `pull` is gated `msg.sender == vault` (one-time-bound via `setVault`,
  reverts on a second call). `fund` is permissionless (anyone may top it up;
  intentional). `withdrawReserve` is `onlyOwner` and can drain the full
  balance at will — accepted, because this reserve holds **Float's own
  capital** funding the stubbed yield seam (`docs/mocked-vs-real.md`), never
  customer principal; customer principal lives in `FloatUSTB` itself, which
  `withdrawReserve` cannot touch.

### `forge lint` exclusions (documented in `foundry.toml`)

`reentrancy-events`, `reentrancy-no-eth`, `unsafe-typecast`,
`internal-function-used-once` are excluded workspace-wide. Every flagged call
site sits inside a `nonReentrant` function, or is Float-internal accounting
against a known-good (no-callback) ERC-20 — the guard is the actual
mitigation, not the lint rule. Verified this remains true for every site
during this review; the exclusion comment in `foundry.toml` is unchanged.

## Off-chain / operational hardening added this phase

- **`agentGuard` (`@float/wallet`)** — interprets the exact permission-spec
  object handed to ZeroDev `toCallPolicy`, run as a pre-flight in the execute
  worker (`packages/wallet/src/guard.ts`, 15 tests). Catches a mis-built
  batch before it burns a bundler round-trip; the cryptographic validator
  remains the actual boundary.
- **Scripted out-of-policy attack** (`attack:out-of-policy` in
  `apps/agent-service`) — nine adversarial UserOperations against a live
  bundler, asserting cryptographic rejection and zero state change. See
  `docs/security-model.md` → "Verifying Layer 1".
- **Gateway rate limiting** (`apps/gateway/src/rate-limit.ts`) — a fixed-window
  per-IP limiter (`GATEWAY_RATE_LIMIT_PER_MINUTE`, default 60/min) in front of
  the free `/v1/policy/:ensName` route and the pre-payment leg of
  `POST /v1/check` (5x budget — paid calls are already throttled
  economically once payment settles). In-memory / single-process; a
  multi-instance deployment should move it to a shared store — see
  `docs/runbook.md`.
- **Admin RBAC** (`apps/web`) — `requireAdmin()` gates every `/api/admin/*`
  route on `role === 'float_staff'` or `ADMIN_ALLOWLIST` membership; regular
  business owners cannot reach the KYC-review or cross-tenant-overview
  endpoints. Reviewed as part of this pass — no gap found.

## Key custody (unchanged from `docs/security-model.md`, restated for this review)

| Key | Now | Target | Blast radius if compromised |
|---|---|---|---|
| Deployer / Float admin (`Ownable2Step` on `FloatUSTB`, `FloatYieldReserve`; `DEFAULT_ADMIN_ROLE` on the two `AccessControl` contracts) | env / EOA | Safe multisig | Can change yield/spread params, drain the Float-funded reserve, or re-point roles. **Cannot** touch a business's own funds — those never sit in a Float-owned contract. |
| Compliance oracle | env, in `apps/agent-service` | KMS / HSM | Can falsely attest or revoke KYC — gates pool access and Layer-1-independent; cannot move funds. |
| Policy-sync | env, in `apps/agent-service` | KMS | Can desync the on-chain policy mirror; `FloatPolicyView` is defense in depth, not the ceiling — Layer 1 still caps the agent. |
| Agent session signer | env, in `apps/agent-service` | KMS, per-tenant isolation | Bounded to `sweepIn`/`sweepOut`/`approve` on the fixed pair, capped at `maxSweepPerTx`, per the Layer 1 call policy — see `docs/security-model.md`. |
| Business owner | the business's wallet | unchanged | Full control of that one business's account; never touches Float infra. |

The `Signer` abstraction in `apps/agent-service/src/signers.ts` is the seam for
the KMS move — swap `envSigner` for a KMS-backed implementation of the same
`FloatSigner` interface; no caller changes.

## Not covered by this pass

- No external audit has been performed. Recommended before any non-test
  capital is at risk.
- `apps/web`, `apps/gateway`, `apps/agent-service` dependency vulnerability
  scanning (`pnpm audit` / Dependabot) is not yet wired into CI.
- Load/DoS testing of the gateway and agent-service under real traffic.
