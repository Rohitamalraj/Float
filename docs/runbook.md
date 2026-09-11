# Operational runbooks

Companion to `docs/security-model.md` (design) and `docs/security-review.md`
(review findings). Each runbook assumes the standard deployment: Postgres +
Redis (`infra/docker-compose.yml`), `apps/agent-service` and `apps/gateway`
running against them, `apps/web` fronting SIWE + the dashboard, contracts
deployed via `contracts/script/{DeployCore,DeployVenue,SeedLiquidity}.s.sol`.

## 1. Key rotation

Applies to the compliance-oracle, policy-sync, and agent-session keys (all
`envSigner`-backed today, per `docs/security-review.md`'s key-custody table).

1. Generate the new key; do **not** delete the old one yet.
2. **Compliance oracle** / **policy-sync**: these are on-chain roles
   (`COMPLIANCE_ORACLE_ROLE`, `POLICY_SYNC_ROLE`). As the `DEFAULT_ADMIN_ROLE`
   holder, grant the role to the new address (`AccessControl.grantRole`),
   verify the new key can write (watch the next `oracle-sync` /
   `policy-sync` worker cycle succeed), then `revokeRole` the old address.
3. **Agent session signer**: this key is *not* a role — it is the address a
   business's owner named when calling `grantAgentSessionKey`. Rotating it
   means **every provisioned business must re-grant** (see runbook 2) with
   the new `agentSignerAddress`. There is no way to swap the signer under an
   existing grant.
4. Update `AGENT_SESSION_SIGNER_PRIVATE_KEY` / `COMPLIANCE_ORACLE_PRIVATE_KEY`
   / `POLICY_SYNC_PRIVATE_KEY` in the agent-service's env and restart it.
   Confirm `/health` and one full evaluate→execute cycle before decommissioning
   the old key material.
5. **Deployer / Float admin** (`Ownable2Step` on `FloatUSTB` /
   `FloatYieldReserve`, `DEFAULT_ADMIN_ROLE` elsewhere): `Ownable2Step`
   requires the new owner to `acceptOwnership()` — call `transferOwnership`
   from the current key, then `acceptOwnership` from the new one. This is the
   key targeted for a Safe multisig migration (`docs/security-review.md`).

Rotation never touches a business owner's own key — Float never holds it.

## 2. Session-key re-grant (per business)

Needed after key rotation (above), a `maxSweepPerTx` change beyond what the
owner's dashboard flow already covers, or suspected compromise of the agent
signer.

1. Business owner (or Float support walking them through it) opens
   **Settings → Agent session key → Revoke**. This calls
   `revokeAgentSessionKey` (owner-signed `uninstallPlugin`) — immediate,
   on-chain, cuts the agent off completely.
2. Confirm in the dashboard that the session-key status is `revoked` and that
   `apps/agent-service`'s next evaluate cycle for this business skips it
   (`getActiveSessionKey` returns none — see `apps/agent-service/src/repo.ts`).
3. Owner re-runs the grant flow (same UI path onboarding uses) with the
   current `agentSignerAddress` and cap. This produces a new
   `serializedApproval`, stored against the business.
4. Verify: run `attack:out-of-policy` against this business
   (`ATTACK_CONFIRM=1 pnpm --filter @float/agent-service attack:out-of-policy
   -- --business <id>`) to confirm the new grant's Layer 1 scope rejects every
   adversarial vector before resuming normal sweeps.

## 3. Compliance-oracle incident (false attestation / suspected compromise)

1. **Contain immediately**: from the `DEFAULT_ADMIN_ROLE` key, `revokeRole`
   the compromised oracle address on `FloatComplianceRegistry`. This stops
   *new* attestations; existing `Verified` accounts remain verified until
   individually revoked or their `expiresAt` lapses.
2. **Assess blast radius**: query `FloatComplianceRegistry.AttestationSet` /
   `AttestationRevoked` events since the suspected compromise window (or the
   `audit_log` table, which records every `kyc.*` action Float's own admin
   flow took) for attestations the legitimate oracle didn't intend.
3. **Revoke individually**: for each affected account, the newly-designated
   oracle key calls `revoke(account)`. This flips `FloatComplianceRegistry`
   immediately; the next `oracle-sync` worker tick mirrors the change to
   `float.kyc-status` on ENS. A revoked account fails
   `FloatAllowlistChecker.checkAllowlist` (no more `SWAP_ALLOWED`) and
   `FloatSweepExecutor`'s `REGISTRY.isVerified` check — both the pool hook and
   the executor stop it, independent of Layer 1.
4. **Rotate the key** per runbook 1, grant `COMPLIANCE_ORACLE_ROLE` to the
   replacement, confirm one clean `oracle-sync` cycle, then `revokeRole` the
   old address.
5. **Re-verify** legitimately-KYC'd businesses that were caught by a blanket
   revoke, via the normal admin-review queue (`/admin` → KYC reviews).

## 4. Pool / venue migration

Moving `FloatUSTB` to a new Uniswap v4 Permissioned Pool (new fee tier, a real
issuer's pool replacing the Float-funded venue, or a hook upgrade).

1. Deploy the new venue: `DeployVenue.s.sol` against the new pool
   parameters, then `SeedLiquidity.s.sol` to seed it
   (`docs/PROGRESS.md` Phase 6). This produces a new `FloatSweepExecutor` —
   the executor is immutable and pair-specific, so a venue change always means
   a new executor address.
2. Update `packages/config`'s `FloatDeployment` resolution (env vars /
   `deployments/<chainId>.venue.json`) to point at the new executor.
3. **Every business's session key must be re-granted** (runbook 2) — the
   Layer 1 `toCallPolicy` targets the executor address explicitly, by design
   (`docs/security-model.md`). There is no way to repoint an existing grant.
4. Roll out business-by-business (not a big-bang cutover): revoke, re-grant,
   confirm one evaluate/execute cycle succeeds against the new executor,
   before moving to the next business. `float.allowed-protocols` (ENS) and
   `FLOAT_PERMISSIONS_ADAPTER_ADDRESS` (env) exist specifically so the
   adapter/pool is swappable by config without touching contract code
   (`docs/mocked-vs-real.md`).
5. Leave the old executor's compliance attestation in place (harmless — it
   just stops being used) or explicitly revoke it if fully decommissioning
   the old venue.

## 5. ENS name migration

Moving a business to a new ENS name (rebrand) or migrating the `float.eth`
parent itself (e.g. ENS v2 leaving beta, or a new registrar).

**Per-business rename:**
1. Provision the new name under the (possibly new) parent via the same
   `planBusinessProvisioning` flow onboarding uses — new subname, new
   Permissioned Resolver proxy, `authorizeTextRoles` role split
   (`packages/ens`).
2. Copy the current policy + compliance records across
   (`readParsedFloatState` → `encodeSetPolicyRecords` /
   `encodeSetComplianceRecords`, signed by the owner and oracle keys
   respectively) — do **not** re-run KYC; the compliance oracle re-attests
   directly.
3. Update `businesses.ensName` / `ensNode` / `ensResolver` in Postgres to the
   new name/resolver. The smart account address and session-key grant are
   unaffected — ENS is only ever a naming + policy-record layer here, never
   part of the security boundary (`docs/security-model.md`).
4. Leave the old name resolvable to the old records for a grace period (or
   set `float.kyc-status` to a non-verified value on it) before letting it
   lapse.

**Parent migration** (`float.eth` itself, or moving off ENS v2 beta): repeat
the per-business steps for every business, batched via a script — the
provisioning plan (`packages/ens/src/provision.ts`) is already parameterized
by parent name, so this is an operational rollout, not a code change.

## 6. Gateway scaling

`apps/gateway`'s rate limiter (`docs/security-review.md`) is in-memory and
single-process. Before running more than one gateway instance behind a load
balancer, replace `apps/gateway/src/rate-limit.ts`'s `Map` with a shared
store (Redis `INCR` + `EXPIRE` on the same key shape) so budgets are enforced
across instances, not per-instance.

## 7. Observability

- `apps/agent-service` and `apps/gateway` both expose `/health` (liveness) —
  agent-service also `/ready` (DB + Redis reachability).
- Structured logs (pino) carry `businessId`, `worker`, and `action` fields —
  filter on `sweep_*.blocked` (guard rejections), `sweep_*.failed`
  (on-chain reverts), and `oracle-sync`/`policy-sync` errors as the primary
  alert signals until a metrics pipeline is wired in.
- Recommended first alerts once a metrics backend is attached: sweep failure
  rate, balance-watcher lag (time since last processed block vs. chain head),
  bundler error rate, and `FloatPolicyView` ↔ ENS policy-record drift
  (compare `policies.policy_view_synced_at` staleness).
