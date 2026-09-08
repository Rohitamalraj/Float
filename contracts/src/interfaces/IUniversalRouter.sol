// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal surface of Uniswap's Universal Router used by Float.
interface IUniversalRouter {
    /// @param commands Packed 1-byte command identifiers.
    /// @param inputs   ABI-encoded input for each command.
    /// @param deadline Latest block timestamp the execution is valid for.
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}
