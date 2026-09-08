// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice The single Uniswap `PermissionedPositionManager` entrypoint Float uses,
///         to seed the pool with initial liquidity.
interface IPermissionedPositionManager {
    /// @param unlockData `abi.encode(bytes actions, bytes[] params)`
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
}
