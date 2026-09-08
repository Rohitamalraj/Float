# Float security model — two layers

The whole product rests on one claim: **a fully compromised agent still cannot move
a business's money anywhere except in and out of the approved yield position, within
a hard per-transaction cap it cannot raise.** That claim is true because of Layer 1.
Layer 2 is convenience that lives *inside* Layer 1's ceiling — never a substitute.

## Layer 1 — cryptographic, human-only to change

The business owns an ERC-4337 (ZeroDev Kernel v3) smart account. Two validators:

- **Owner validator** — the business's key. Root control: sets policy, grants and
  revokes the agent, can recover the account independently of Float. Float never
  holds this key.
- **Agent session key** — a `@zerodev/permissions` permission validator whose
  `toCallPolicy` (V0_0_4) permits *exactly*:

  | Target | Selector | Constraints |
  |---|---|---|
  | `FloatSweepExecutor` | `sweepIn(uint256,uint256)` | `value == 0`, `args[0] ≤ maxSweepPerTx` |
  | `FloatSweepExecutor` | `sweepOut(uint256,uint256)` | `value == 0`, `args[0] ≤ maxSweepPerTx` |
  | `USDC` | `approve(address,uint256)` | `args[0] == FloatSweepExecutor`, `args[1] ≤ maxSweepPerTx` |

  Nothing else is signable. `maxSweepPerTx` is a constant baked into the grant at
  signing time. Changing any of this requires a **new grant transaction signed by
  the owner key**. Revocation is `uninstallPlugin` by the owner.

Why an executor instead of pointing the key straight at a pool `swap()`: Uniswap
Permissioned Pools route through the Universal Router with ABI-encoded commands, so
`toCallPolicy` cannot bound the amount or the token pair on a direct router call.
`FloatSweepExecutor` is the minimal shim that makes the cap and the pair
cryptographically enforceable. It is immutable, unprivileged, has no admin, and only
ever moves `msg.sender`'s own funds (pull via `transferFrom`, return to
`msg.sender`). On any revert the whole transaction unwinds — no stuck funds.

### Defense in depth inside the executor

Even though Layer 1 already bounds the call, the executor independently checks, on
chain, every sweep:

1. `FloatComplianceRegistry.isVerified(msg.sender)` — the business itself is
   allowlisted (not just the executor).
2. `FloatPolicyView.maxSweepPerTx(msg.sender)` — the amount is within the mirrored
   policy cap. For `sweepOut` the cap is applied to the USDC-equivalent value.
3. The swap runs through the **Permissioned Pool hook**, which calls
   `FloatAllowlistChecker.checkAllowlist(msgSender)` → `isVerified(executor)`.

## Layer 2 — off-chain, business-editable

The ENS policy records on `mybiz.eth` (`float.buffer-amount`, `float.max-sweep-per-tx`,
`float.allowed-protocols`, `float.target-yield-token`) are the "current settings" the
agent's `evaluateSweep` reads before acting. A business changes its buffer by writing
a text record — no on-chain account transaction.

`FloatPolicyView` mirrors `buffer` and `max-sweep-per-tx` on chain so the executor
can enforce them synchronously. The agent service's policy-sync worker
(`POLICY_SYNC_ROLE`) keeps the mirror equal to the ENS records and reconciles drift.

Layer 2 alone would be a soft policy an attacker could try to route around. Layer 1
is why that does not matter: the mirror can only ever be *stricter or equal in
effect* than the Layer 1 constant, and the Layer 1 constant is the real ceiling.

## Compliance authority

`float.kyc-status`, `float.allowlist-id`, `float.kyc-verified-at`,
`float.accreditation` are writable **only** by the Float compliance-oracle key
(ENS Enhanced Access Control, per-record role). The same oracle writes
`FloatComplianceRegistry`. The business owner can never write these; the agent can
never write anything. See `docs/mocked-vs-real.md` for how attestations are sourced.

## Key custody (current vs. target)

| Key | Now | Target |
|---|---|---|
| Deployer / Float admin | env / EOA | Safe multisig |
| Compliance oracle | env, in `apps/agent-service` | KMS / HSM signer |
| Agent session signer | env, in `apps/agent-service` | KMS, per-tenant isolation |
| Business owner | the business's wallet | unchanged — never touches Float infra |

The `Signer` abstraction in `apps/agent-service` is the seam for the KMS move.
