// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IFloatYieldReserve} from "@float/interfaces/IFloatYieldReserve.sol";

/// @title FloatUSTB
/// @notice A yield-bearing ERC-4626 vault over USDC that is the tokenized-Treasury
///         leg of Float's Uniswap v4 Permissioned Pool.
///
/// @dev Yield accrues continuously at `grossYieldRateBps` (annualised, simple) on
///      the vault's USDC principal and is realised by pulling USDC from
///      {FloatYieldReserve} on every state-changing entrypoint (or via {accrue}).
///      Float retains `spreadShareBps` of each realised yield tranche (its
///      business-model Line 1); the remainder lifts the share price for holders.
///
///      Direct 4626 access is permissionless by design — it is the holder's own
///      capital. Compliance is enforced on the *agent* path, at the permissioned
///      pool + {FloatSweepExecutor}.
contract FloatUSTB is ERC4626, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    uint256 internal constant SECONDS_PER_YEAR = 365 days;
    uint256 internal constant BPS = 10_000;
    uint16 internal constant MAX_YIELD_RATE_BPS = 5_000; // 50% APR sanity ceiling

    IFloatYieldReserve public immutable RESERVE;
    address public immutable TREASURY;

    /// @notice Gross annualised yield rate in basis points (e.g. 450 == 4.5%).
    uint16 public grossYieldRateBps;
    /// @notice Share of each realised yield tranche Float keeps, in bps (e.g. 1000 == 10%).
    uint16 public spreadShareBps;

    uint64 public lastAccrualAt;
    /// @notice USDC principal the current accrual period is computed on.
    uint256 public accrualPrincipal;

    event YieldAccrued(uint256 grossPulled, uint256 floatSpread, uint256 toDepositors);
    event YieldRateUpdated(uint16 oldBps, uint16 newBps);
    event SpreadShareUpdated(uint16 oldBps, uint16 newBps);

    error ZeroAddress();
    error RateTooHigh(uint16 bps);
    error SpreadTooHigh(uint16 bps);

    constructor(
        IERC20 usdc,
        IFloatYieldReserve reserve,
        address treasury,
        address owner_,
        uint16 grossYieldRateBps_,
        uint16 spreadShareBps_
    ) ERC20("Float US Treasury Vault", "fUSTB") ERC4626(usdc) Ownable(owner_) {
        if (address(reserve) == address(0) || treasury == address(0) || owner_ == address(0)) {
            revert ZeroAddress();
        }
        if (grossYieldRateBps_ > MAX_YIELD_RATE_BPS) revert RateTooHigh(grossYieldRateBps_);
        if (spreadShareBps_ >= BPS) revert SpreadTooHigh(spreadShareBps_);
        RESERVE = reserve;
        TREASURY = treasury;
        grossYieldRateBps = grossYieldRateBps_;
        spreadShareBps = spreadShareBps_;
        lastAccrualAt = uint64(block.timestamp);
    }

    // ── Yield accounting ─────────────────────────────────────────────────────

    /// @dev Gross yield owed since `lastAccrualAt`, capped at the reserve balance.
    function _pendingGrossYield() internal view returns (uint256) {
        uint256 dt = block.timestamp - lastAccrualAt;
        if (dt == 0 || accrualPrincipal == 0 || grossYieldRateBps == 0) return 0;
        uint256 gross = accrualPrincipal.mulDiv(uint256(grossYieldRateBps) * dt, SECONDS_PER_YEAR * BPS);
        uint256 avail = RESERVE.available();
        return gross > avail ? avail : gross;
    }

    function _pendingNetYield() internal view returns (uint256) {
        uint256 gross = _pendingGrossYield();
        return gross - gross.mulDiv(spreadShareBps, BPS);
    }

    /// @inheritdoc ERC4626
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + _pendingNetYield();
    }

    /// @notice Realise accrued yield without any deposit/withdrawal. Keeper-callable.
    function accrue() external nonReentrant {
        _accrue();
        _syncPrincipal();
    }

    function _accrue() internal {
        uint256 gross = _pendingGrossYield();
        if (gross > 0) {
            uint256 pulled = RESERVE.pull(gross, address(this));
            uint256 spread = pulled.mulDiv(spreadShareBps, BPS);
            if (spread > 0) IERC20(asset()).safeTransfer(TREASURY, spread);
            emit YieldAccrued(pulled, spread, pulled - spread);
        }
        lastAccrualAt = uint64(block.timestamp);
    }

    function _syncPrincipal() internal {
        accrualPrincipal = IERC20(asset()).balanceOf(address(this));
    }

    // ── ERC-4626 entrypoints: settle yield first, then re-sync principal ──────

    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256 shares) {
        _accrue();
        shares = super.deposit(assets, receiver);
        _syncPrincipal();
    }

    function mint(uint256 shares, address receiver) public override nonReentrant returns (uint256 assets) {
        _accrue();
        assets = super.mint(shares, receiver);
        _syncPrincipal();
    }

    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        _accrue();
        shares = super.withdraw(assets, receiver, owner_);
        _syncPrincipal();
    }

    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        _accrue();
        assets = super.redeem(shares, receiver, owner_);
        _syncPrincipal();
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function setYieldRateBps(uint16 newBps) external nonReentrant onlyOwner {
        if (newBps > MAX_YIELD_RATE_BPS) revert RateTooHigh(newBps);
        _accrue(); // settle at the old rate before it changes
        _syncPrincipal();
        emit YieldRateUpdated(grossYieldRateBps, newBps);
        grossYieldRateBps = newBps;
    }

    function setSpreadShareBps(uint16 newBps) external nonReentrant onlyOwner {
        if (newBps >= BPS) revert SpreadTooHigh(newBps);
        _accrue();
        _syncPrincipal();
        emit SpreadShareUpdated(spreadShareBps, newBps);
        spreadShareBps = newBps;
    }

    /// @dev Inflation-attack mitigation for a 6-decimal underlying.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 3;
    }
}
