// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IFloatSweepExecutor
/// @notice The single contract a business's agent session key is permitted to
///         call (Layer 1 of Float's security model). It can do exactly two
///         things, and only ever with the caller's own funds:
///           - sweepIn:  USDC held by `msg.sender` → FloatUSTB (parked yield)
///           - sweepOut: FloatUSTB held by `msg.sender` → USDC (restore liquidity)
///         Every route goes through Float's Uniswap v4 Permissioned Pool, so the
///         pool hook's allowlist check runs on every sweep. There is no admin, no
///         upgrade path, and no way to move funds to a third party.
interface IFloatSweepExecutor {
    event SweptIn(address indexed account, uint256 usdcIn, uint256 minTokenOut, address indexed recipient);
    event SweptOut(address indexed account, uint256 tokenIn, uint256 minUsdcOut, address indexed recipient);

    error NotVerified(address account);
    error AmountZero();
    error ExceedsPolicyCap(uint256 requested, uint256 cap);

    /// @notice Swap `usdcIn` USDC (pulled from `msg.sender`) into FloatUSTB,
    ///         delivered to `msg.sender`. Reverts unless `msg.sender` is verified
    ///         in the compliance registry and `usdcIn` is within its policy cap.
    /// @param usdcIn USDC base units to park.
    /// @param minTokenOut Minimum FloatUSTB out (slippage bound, enforced by the pool).
    function sweepIn(uint256 usdcIn, uint256 minTokenOut) external;

    /// @notice Swap `tokenIn` FloatUSTB (pulled from `msg.sender`) back into USDC,
    ///         delivered to `msg.sender`. Cap is checked on the USDC-equivalent value.
    /// @param tokenIn FloatUSTB base units to redeem.
    /// @param minUsdcOut Minimum USDC out (slippage bound, enforced by the pool).
    function sweepOut(uint256 tokenIn, uint256 minUsdcOut) external;

    /// @notice Immutable wiring, for SDK / off-chain consumers.
    function config()
        external
        view
        returns (
            address usdc,
            address floatUstb,
            address permissionsAdapter,
            address universalRouter,
            address complianceRegistry,
            address policyView
        );
}
