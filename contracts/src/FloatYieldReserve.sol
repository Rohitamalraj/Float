// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFloatYieldReserve} from "@float/interfaces/IFloatYieldReserve.sol";

/// @title FloatYieldReserve
/// @notice See {IFloatYieldReserve}.
contract FloatYieldReserve is Ownable2Step, ReentrancyGuard, IFloatYieldReserve {
    using SafeERC20 for IERC20;

    IERC20 public immutable ASSET;
    address public vault;

    constructor(IERC20 asset_, address owner_) Ownable(owner_) {
        if (address(asset_) == address(0) || owner_ == address(0)) revert ZeroAddress();
        ASSET = asset_;
    }

    /// @notice One-time binding of the vault that may {pull} yield.
    function setVault(address vault_) external onlyOwner {
        if (vault_ == address(0)) revert ZeroAddress();
        if (vault != address(0)) revert VaultAlreadySet();
        vault = vault_;
        emit VaultSet(vault_);
    }

    /// @inheritdoc IFloatYieldReserve
    function fund(uint256 amount) external nonReentrant {
        ASSET.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    /// @notice Recover surplus reserve funds. Owner only.
    function withdrawReserve(uint256 amount, address to) external nonReentrant onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        ASSET.safeTransfer(to, amount);
        emit ReserveWithdrawn(to, amount);
    }

    /// @inheritdoc IFloatYieldReserve
    function available() public view returns (uint256) {
        return ASSET.balanceOf(address(this));
    }

    /// @inheritdoc IFloatYieldReserve
    function pull(uint256 amount, address to) external nonReentrant returns (uint256 sent) {
        if (msg.sender != vault) revert NotVault(msg.sender);
        uint256 bal = available();
        sent = amount > bal ? bal : amount;
        if (sent > 0) {
            ASSET.safeTransfer(to, sent);
            emit YieldPulled(to, sent);
        }
    }
}
