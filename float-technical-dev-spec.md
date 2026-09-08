# Float — Technical PRD (Engineering Spec)
### For development — ETHOnline 2026

This is the build spec. For the product case (market, competition, business model), see `float-FINAL-PRD.md`. This document assumes that context and goes straight to architecture, interfaces, and sequencing.

---

## 1. System architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        mybiz.eth (ENS v2)                        │
│  Permissioned Registry + Permissioned Resolver, Sepolia          │
│                                                                    │
│  Policy records          │  Compliance records                   │
│  (owner-writable only)   │  (issuer-oracle-writable only)         │
│  float.buffer-amount     │  float.kyc-status                     │
│  float.max-sweep-per-tx  │  float.allowlist-id                   │
│  float.allowed-protocols │  float.kyc-verified-at                │
│         ↑ resolves to ↓                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Smart wallet (ERC-4337 account, Sepolia)             │
│  Owner key: business (root control, signs policy + key grants)   │
│  Session key: agent (scoped — see §4)                            │
└─────────────────────────────────────────────────────────────────┘
                    │                              │
                    ▼                              ▼
┌───────────────────────────────┐   ┌──────────────────────────────┐
│  Off-chain agent service       │   │  Uniswap v4 Permissioned Pool │
│  - watches balance             │──▶│  (issuer's tokenized Treasury │
│  - reads ENS policy            │   │   pool, e.g. Superstate)      │
│  - decides sweep in/out        │◀──│  hook enforces allowlist      │
│  - signs w/ session key        │   └──────────────────────────────┘
└───────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Bazantic x402 Gateway — /v1/check endpoint                       │
│  Exposes the sweep-decision logic to other agents, metered        │
└─────────────────────────────────────────────────────────────────┘
```

**Chain/network:** Sepolia testnet throughout — ENS v2 beta, the target Permissioned Pool, and the smart wallet all need to resolve on the same testnet. Confirm this alignment before writing any code (see §9).

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Smart account | ERC-4337 via ZeroDev Kernel (or Safe{Core} + Safe 4337 Module as fallback) | Both support scoped session keys natively — don't hand-roll this |
| Contracts | Solidity, Foundry | Standard tooling, fast local testing against forked Sepolia |
| Agent service | TypeScript / Node.js | Matches ecosystem tooling (viem/ethers, ENS SDK, Bazantic likely has JS-first docs) |
| ENS interaction | viem + ENS v2 SDK / Permissioned Registry contracts | Confirm exact package once ENSv2 tooling docs are checked |
| Bazantic Gateway | Deployed via bazantic.com dashboard, wrapping the agent service's REST endpoint | No separate infra needed — Bazantic hosts the payment/discovery layer |

---

## 3. Repo structure

```
float/
├── contracts/
│   ├── src/
│   │   └── (only if a custom session-key validator beyond Kernel's default is needed)
│   ├── script/          # deployment scripts
│   ├── test/
│   └── foundry.toml
├── agent-service/
│   ├── src/
│   │   ├── watchers/balanceWatcher.ts
│   │   ├── decision/sweepEngine.ts
│   │   ├── ens/policyReader.ts
│   │   ├── ens/complianceReader.ts
│   │   ├── uniswap/permissionedPoolClient.ts
│   │   ├── wallet/sessionKeySigner.ts
│   │   └── index.ts
│   └── package.json
├── bazantic-gateway/
│   └── src/routes/check.ts      # same logic as sweepEngine, exposed as HTTP
├── docs/
│   ├── FEEDBACK.md
│   ├── architecture-diagram.png
│   └── demo-script.md
└── README.md
```

---

## 4. Security enforcement model — two layers, know the difference

This is the part worth being precise about, since it's the whole product's safety claim.

**Layer 1 — onchain, cryptographically enforced, human-only to change.**
The agent's session key is granted with a hard scope at creation time:
```
SessionKeyPermission {
  validAfter, validUntil: uint48
  targetContract: address        // only the specific Permissioned Pool's swap entrypoint
  allowedSelector: bytes4        // only the swap() function, nothing else
  valueLimit: uint256            // hard max per transaction
  tokenPair: [stablecoin, treasuryToken]  // no other pair callable
}
```
This is checked by the smart account's own validation logic before any signature from the session key is accepted — it's not application logic, it's what the key is cryptographically capable of authorizing at all. Even a fully compromised agent service cannot produce a valid signature for anything outside this. Changing it requires a new grant transaction signed by the business's owner key.

**Layer 2 — off-chain, day-to-day, business-editable.**
The ENS policy records (`float.buffer-amount`, etc.) are the "current settings" the agent's decision logic reads before acting — this is what lets a business change its buffer amount without a new onchain transaction. It's convenience logic sitting inside the hard ceiling set by Layer 1, not a replacement for it.

**Don't conflate the two in the build or the demo.** The pitch — "the agent can never grant itself permission" — is true because of Layer 1, not Layer 2. Layer 2 alone would be a soft policy an attacker could try to route around; Layer 1 is why that doesn't matter.

---

## 5. ENS record schema

```
mybiz.eth
├── float.buffer-amount        "2000"              (owner-writable)
├── float.max-sweep-per-tx     "10000"             (owner-writable)
├── float.allowed-protocols    "0x<pool-address>"  (owner-writable)
├── float.kyc-status           "verified"          (issuer-oracle-writable only)
├── float.allowlist-id         "superstate-ustb-1" (issuer-oracle-writable only)
└── float.kyc-verified-at      "2026-09-08T00:00Z" (issuer-oracle-writable only)
```
Enforce the write split via ENSv2 Enhanced Access Control roles at the resolver level — two roles: `owner-role` (business's key) and `compliance-oracle-role` (a separate key/contract the issuer controls). Confirm exact role-granting API from the Enhanced Access Control docs before implementing (see §9).

---

## 6. Off-chain agent decision logic (pseudocode)

```typescript
async function evaluateSweep(ensName: string, walletAddress: string) {
  const kyc = await readCompliance(ensName);
  if (kyc.status !== 'verified') {
    return { action: 'none', reason: 'not allowlisted' };
  }

  const policy = await readPolicy(ensName);
  const balance = await getStablecoinBalance(walletAddress);
  const idle = balance - policy.bufferAmount;

  if (idle > 0) {
    const amount = Math.min(idle, policy.maxSweepPerTx);
    return { action: 'sweep_in', amount };
  }

  const upcoming = await checkUpcomingObligation(walletAddress); // scheduled payment or simple heuristic for demo
  if (upcoming && balance < policy.bufferAmount + upcoming.amount) {
    return { action: 'sweep_out', amount: upcoming.amount };
  }

  return { action: 'none' };
}
```

Execution: once a decision is made, the agent service constructs the UserOperation calling the Permissioned Pool's swap function, signs it with the session key, submits via bundler. If the amount or target falls outside the Layer 1 scope, the signature is invalid and the transaction reverts — this should never happen if the off-chain logic is correct, but it's the actual backstop if it isn't.

---

## 7. Bazantic Gateway endpoint

```
POST /v1/check
Request:
{
  "ensName": "mybiz.eth",
  "requestedAction": "sweep_in",
  "amount": "6000"
}

Response:
{
  "allowed": true,
  "reason": "KYC verified, within policy",
  "recommendedAmount": "6000"
}
```
Same logic as `evaluateSweep`, exposed as a stateless HTTP check any external agent can call. Wrap this route with Bazantic's x402/MPP Gateway (per-call payment, e.g. $0.01 USDC) — deployed via the bazantic.com dashboard, not custom-built. The Recipe documents the calling sequence: resolve ENS → call `/v1/check` → if allowed, call Uniswap's swap endpoint with `recommendedAmount`.

---

## 8. Sequence flows

**A. Onboarding**
1. Business signs up, completes KYC with the issuer.
2. Issuer's compliance oracle writes `float.kyc-status = verified` + `float.allowlist-id` to `mybiz.eth`.
3. Smart wallet deployed, business holds owner key.
4. Business sets initial policy records (buffer, max-sweep).
5. Business signs the session key grant transaction, authorizing the agent within Layer 1 scope.

**B. Sweep-in**
1. Payment lands in wallet → balance watcher detects change.
2. Agent evaluates: idle > 0 → constructs swap UserOp.
3. Session key signs, submitted via bundler.
4. Permissioned Pool hook checks `mybiz.eth`'s allowlist status onchain → passes → swap executes.
5. Treasury token now held in wallet.

**C. Sweep-out**
1. Upcoming obligation detected (or balance dips below buffer + due amount).
2. Agent constructs reverse swap, same signing/execution path as B.

**D. Blocked attempt (demo scenario)**
1. Scripted "prompt-injected" instruction attempts a transfer outside policy (different target contract, or amount over `max-sweep-per-tx`).
2. Session key signature is invalid for that call — Layer 1 rejects it before it reaches the pool.
3. Shown on screen: transaction fails, ENS policy record unchanged, wallet balance unaffected.

**E. External agent using the Bazantic Recipe**
1. Third-party agent resolves `mybiz.eth`, reads that a sweep-check service exists (via Bazantic discovery / the Recipe).
2. Pays x402 fee, calls `/v1/check`.
3. Gets `allowed`/`recommendedAmount` back, proceeds with its own logic.

---

## 9. Confirm before coding (Day 1)

- [ ] Exact ENS v2 Permissioned Registry + Enhanced Access Control contract addresses on Sepolia, and the role-granting call pattern
- [ ] A specific Uniswap v4 Permissioned Pool deployment reachable on Sepolia (which issuer, which pool address, which hook) — or confirm the fallback plan to deploy a minimal mock using the real hook interface
- [ ] Bazantic account created, Gateway deployment flow confirmed, exact Recipe schema/format
- [ ] Chosen AA SDK's (ZeroDev Kernel or Safe) exact session-key permission API and whether it supports the parameter-level restrictions described in §4 (contract + selector + value limit + token pair) out of the box, or whether a custom validator module is needed

---

## 10. Demo script (for the recording)

1. Show `mybiz.eth` resolving to the smart wallet, policy + compliance records visible on a block explorer.
2. Trigger a payment into the wallet → show the balance watcher log the idle amount.
3. Show the sweep-in transaction land, treasury token balance appear.
4. Trigger the scripted out-of-policy attempt → show it fail, explain why (Layer 1 scope, not a policy check that could be bypassed).
5. Trigger the sweep-out (simulated bill due) → show funds return to stablecoin in time.
6. Switch to an external agent calling the Bazantic `/v1/check` endpoint directly, paying via x402, getting a real response — demonstrates the Recipe working with zero custom logic beyond what the Recipe itself specifies.
