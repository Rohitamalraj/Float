// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IFloatPolicyView
/// @notice On-chain mirror of the Layer 2 policy (`float.buffer-amount`,
///         `float.max-sweep-per-tx`) that lives authoritatively in ENS records.
///         {FloatSweepExecutor} reads it for a defense-in-depth cap check without
///         an ENS round-trip. Kept in sync by the agent service's policy-sync
///         worker (`POLICY_SYNC_ROLE`).
interface IFloatPolicyView {
    struct AccountPolicy {
        bool set;
        uint128 bufferAmount;
        uint128 maxSweepPerTx;
    }

    event PolicySynced(address indexed account, uint128 bufferAmount, uint128 maxSweepPerTx, address indexed by);
    event PolicyCleared(address indexed account, address indexed by);

    error PolicyNotSet(address account);
    error ZeroAccount();

    function setPolicy(address account, uint128 bufferAmount, uint128 maxSweepPerTx) external;

    function clearPolicy(address account) external;

    function policyOf(address account) external view returns (AccountPolicy memory);

    /// @notice Max single sweep for `account`, USDC base units. Reverts if unset.
    function maxSweepPerTx(address account) external view returns (uint256);

    /// @notice Working-capital buffer for `account`, USDC base units. Reverts if unset.
    function bufferAmount(address account) external view returns (uint256);
}
