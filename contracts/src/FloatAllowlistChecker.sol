// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseAllowlistChecker} from "@uniswap/v4-periphery/src/hooks/permissionedPools/BaseAllowListChecker.sol";
import {
    PermissionFlag,
    PermissionFlags
} from "@uniswap/v4-periphery/src/hooks/permissionedPools/libraries/PermissionFlags.sol";
import {IFloatComplianceRegistry} from "@float/interfaces/IFloatComplianceRegistry.sol";

/// @title FloatAllowlistChecker
/// @notice `IAllowlistChecker` for Float's Uniswap v4 Permissioned Pool. Bridges
///         the pool's protocol-level allowlist to {FloatComplianceRegistry}, so a
///         single attestation governs both the on-chain swap gate and the ENS
///         `float.kyc-status` record.
/// @dev The account the pool passes here is the router caller (`msgSender()`),
///      which for Float is always {FloatSweepExecutor}. Per-business compliance is
///      enforced a second time inside the executor. Float's liquidity manager is
///      additionally granted LIQUIDITY_ALLOWED so it can provide/withdraw LP.
contract FloatAllowlistChecker is BaseAllowlistChecker {
    IFloatComplianceRegistry public immutable REGISTRY;

    /// @notice Account permitted to add/remove liquidity (Float's LP manager).
    address public immutable LIQUIDITY_MANAGER;

    constructor(IFloatComplianceRegistry registry, address liquidityManager) {
        REGISTRY = registry;
        LIQUIDITY_MANAGER = liquidityManager;
    }

    /// @inheritdoc BaseAllowlistChecker
    function checkAllowlist(
        address account,
        address /*tokenAddress*/
    )
        public
        view
        override
        returns (PermissionFlag)
    {
        PermissionFlag flag = PermissionFlags.NONE;
        if (REGISTRY.isVerified(account)) {
            flag = flag | PermissionFlags.SWAP_ALLOWED;
        }
        if (account == LIQUIDITY_MANAGER) {
            flag = flag | PermissionFlags.SWAP_ALLOWED | PermissionFlags.LIQUIDITY_ALLOWED;
        }
        return flag;
    }
}
