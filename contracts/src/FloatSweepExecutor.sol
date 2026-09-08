// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {IFloatSweepExecutor} from "@float/interfaces/IFloatSweepExecutor.sol";
import {IUniversalRouter} from "@float/interfaces/IUniversalRouter.sol";
import {IFloatComplianceRegistry} from "@float/interfaces/IFloatComplianceRegistry.sol";
import {IFloatPolicyView} from "@float/interfaces/IFloatPolicyView.sol";
import {FloatSwapEncoder} from "@float/libraries/FloatSwapEncoder.sol";

/// @title FloatSweepExecutor
/// @notice See {IFloatSweepExecutor}. Minimal, immutable, unprivileged.
contract FloatSweepExecutor is IFloatSweepExecutor, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    IERC20 public immutable USDC;
    IERC20 public immutable FLOAT_USTB;
    IERC4626 public immutable VAULT;
    address public immutable ADAPTER;
    IUniversalRouter public immutable ROUTER;
    IAllowanceTransfer public immutable PERMIT2;
    IFloatComplianceRegistry public immutable REGISTRY;
    IFloatPolicyView public immutable POLICY_VIEW;

    // Pool key components (currencies are sorted numerically per v4).
    address private immutable CURRENCY0;
    address private immutable CURRENCY1;
    uint24 private immutable FEE;
    int24 private immutable TICK_SPACING;
    address private immutable HOOKS;
    bool public immutable USDC_IS_CURRENCY0;

    uint48 private constant ALLOWANCE_TTL = 600;

    struct Wiring {
        IERC20 usdc;
        IERC20 floatUstb;
        address adapter;
        IUniversalRouter router;
        address permit2;
        IFloatComplianceRegistry registry;
        IFloatPolicyView policyView;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    constructor(Wiring memory w) {
        USDC = w.usdc;
        FLOAT_USTB = w.floatUstb;
        VAULT = IERC4626(address(w.floatUstb));
        ADAPTER = w.adapter;
        ROUTER = w.router;
        PERMIT2 = IAllowanceTransfer(w.permit2);
        REGISTRY = w.registry;
        POLICY_VIEW = w.policyView;

        bool usdcIsC0 = uint160(address(w.usdc)) < uint160(w.adapter);
        USDC_IS_CURRENCY0 = usdcIsC0;
        CURRENCY0 = usdcIsC0 ? address(w.usdc) : w.adapter;
        CURRENCY1 = usdcIsC0 ? w.adapter : address(w.usdc);
        FEE = w.fee;
        TICK_SPACING = w.tickSpacing;
        HOOKS = w.hooks;
    }

    /// @inheritdoc IFloatSweepExecutor
    function sweepIn(uint256 usdcIn, uint256 minTokenOut) external nonReentrant {
        if (usdcIn == 0) revert AmountZero();
        address account = msg.sender;
        if (!REGISTRY.isVerified(account)) revert NotVerified(account);
        uint256 cap = POLICY_VIEW.maxSweepPerTx(account);
        if (usdcIn > cap) revert ExceedsPolicyCap(usdcIn, cap);

        USDC.safeTransferFrom(account, address(this), usdcIn);
        _authorizeRouter(USDC, usdcIn);

        _route(
            FloatSwapEncoder.SwapPlan({
                poolKey: _poolKey(),
                zeroForOne: USDC_IS_CURRENCY0,
                amountIn: usdcIn.toUint128(),
                amountOutMinimum: minTokenOut.toUint128(),
                inputCurrency: Currency.wrap(address(USDC)),
                outputCurrency: Currency.wrap(ADAPTER),
                recipient: account
            })
        );

        emit SweptIn(account, usdcIn, minTokenOut, account);
    }

    /// @inheritdoc IFloatSweepExecutor
    function sweepOut(uint256 tokenIn, uint256 minUsdcOut) external nonReentrant {
        if (tokenIn == 0) revert AmountZero();
        address account = msg.sender;
        if (!REGISTRY.isVerified(account)) revert NotVerified(account);

        uint256 usdcValue = VAULT.convertToAssets(tokenIn);
        uint256 cap = POLICY_VIEW.maxSweepPerTx(account);
        if (usdcValue > cap) revert ExceedsPolicyCap(usdcValue, cap);

        FLOAT_USTB.safeTransferFrom(account, address(this), tokenIn);
        _authorizeRouter(FLOAT_USTB, tokenIn);

        _route(
            FloatSwapEncoder.SwapPlan({
                poolKey: _poolKey(),
                zeroForOne: !USDC_IS_CURRENCY0,
                amountIn: tokenIn.toUint128(),
                amountOutMinimum: minUsdcOut.toUint128(),
                inputCurrency: Currency.wrap(ADAPTER),
                outputCurrency: Currency.wrap(address(USDC)),
                recipient: account
            })
        );

        emit SweptOut(account, tokenIn, minUsdcOut, account);
    }

    /// @inheritdoc IFloatSweepExecutor
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
        )
    {
        return (address(USDC), address(FLOAT_USTB), ADAPTER, address(ROUTER), address(REGISTRY), address(POLICY_VIEW));
    }

    // ── internals ────────────────────────────────────────────────────────────

    function _route(FloatSwapEncoder.SwapPlan memory plan) private {
        (bytes memory commands, bytes[] memory inputs) = FloatSwapEncoder.encode(plan);
        ROUTER.execute(commands, inputs, block.timestamp);
    }

    /// @dev Ensures Permit2 can pull `token` from this contract and grants the
    ///      Universal Router an exact, short-lived Permit2 allowance for `amount`.
    function _authorizeRouter(IERC20 token, uint256 amount) private {
        if (token.allowance(address(this), address(PERMIT2)) < amount) {
            token.forceApprove(address(PERMIT2), type(uint256).max);
        }
        PERMIT2.approve(address(token), address(ROUTER), amount.toUint160(), uint48(block.timestamp) + ALLOWANCE_TTL);
    }

    function _poolKey() private view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(CURRENCY0),
            currency1: Currency.wrap(CURRENCY1),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(HOOKS)
        });
    }
}
