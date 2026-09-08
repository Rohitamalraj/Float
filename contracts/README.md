# Float contracts

Foundry project for Float's on-chain layer. See [`../docs/security-model.md`](../docs/security-model.md)
for the Layer 1 / Layer 2 design and [`../docs/architecture.md`](../docs/architecture.md) for how
these fit the whole system.

## Contracts (`src/`)

| Contract | Role |
|---|---|
| `FloatComplianceRegistry` | oracle-gated KYC attestations (expiry, revoke) — the allowlist source of truth |
| `FloatAllowlistChecker` | implements Uniswap's `IAllowlistChecker`; bridges the pool hook to the registry |
| `FloatPolicyView` | on-chain mirror of `buffer` / `max-sweep-per-tx` for the executor's cap check |
| `FloatSweepExecutor` | **the only contract the agent session key may call** — `sweepIn` / `sweepOut` via the permissioned Universal Router; immutable, unprivileged |
| `FloatUSTB` | ERC-4626 vault over USDC; the tokenized-Treasury leg of the pool |
| `FloatYieldReserve` | Float-funded USDC reserve that pays FloatUSTB's yield |
| `libraries/FloatSwapEncoder` | builds the `V4_SWAP` command bytes (`SWAP_EXACT_IN_SINGLE → SETTLE_ALL → TAKE`) |

## Develop

```bash
forge install        # restore deps from foundry.lock (forge-std, v4-periphery @3245c3cb)
forge build
forge test
forge lint && forge fmt --check
```

## Deploy (Sepolia)

```bash
forge script script/DeployCore.s.sol  --rpc-url sepolia --broadcast
forge script script/DeployVenue.s.sol --rpc-url sepolia --broadcast
# addresses -> deployments/<chainId>.{core,venue}.json
```

Required env (see [`../.env.example`](../.env.example)): `DEPLOYER_PRIVATE_KEY`,
`COMPLIANCE_ORACLE_PRIVATE_KEY`, `USDC_ADDRESS`, `FLOAT_ADMIN_ADDRESS`,
`FLOAT_TREASURY_ADDRESS`, `COMPLIANCE_ORACLE_ADDRESS`, `POLICY_SYNC_ADDRESS`,
`LIQUIDITY_MANAGER_ADDRESS`.
