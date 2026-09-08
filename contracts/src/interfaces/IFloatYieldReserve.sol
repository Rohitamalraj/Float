// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IFloatYieldReserve
/// @notice A Float-funded USDC reserve that pays the yield {FloatUSTB} distributes.
/// @dev This stands in for a live tokenized-Treasury issuer feed: the accrual
///      plumbing is production-real, the yield *source* is a Float reserve until
///      wired to an issuer. See `docs/mocked-vs-real.md`.
interface IFloatYieldReserve {
    event Funded(address indexed from, uint256 amount);
    event ReserveWithdrawn(address indexed to, uint256 amount);
    event YieldPulled(address indexed to, uint256 amount);
    event VaultSet(address indexed vault);

    error NotVault(address caller);
    error VaultAlreadySet();
    error ZeroAddress();

    /// @notice Top up the reserve with USDC (pulled from caller).
    function fund(uint256 amount) external;

    /// @notice USDC currently held by the reserve and available to pay yield.
    function available() external view returns (uint256);

    /// @notice Transfer up to `amount` USDC to `to`. Vault only. Returns amount sent.
    function pull(uint256 amount, address to) external returns (uint256 sent);
}
