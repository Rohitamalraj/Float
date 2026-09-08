// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {
    IPermissionsAdapterFactory
} from "@uniswap/v4-periphery/src/hooks/permissionedPools/interfaces/IPermissionsAdapterFactory.sol";
import {
    IPermissionsAdapter
} from "@uniswap/v4-periphery/src/hooks/permissionedPools/interfaces/IPermissionsAdapter.sol";
import {IAllowlistChecker} from "@uniswap/v4-periphery/src/hooks/permissionedPools/interfaces/IAllowlistChecker.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {FloatComplianceRegistry} from "@float/FloatComplianceRegistry.sol";
import {IFloatComplianceRegistry} from "@float/interfaces/IFloatComplianceRegistry.sol";
import {FloatAllowlistChecker} from "@float/FloatAllowlistChecker.sol";
import {FloatPolicyView} from "@float/FloatPolicyView.sol";
import {FloatYieldReserve} from "@float/FloatYieldReserve.sol";
import {IFloatYieldReserve} from "@float/interfaces/IFloatYieldReserve.sol";
import {FloatUSTB} from "@float/FloatUSTB.sol";
import {FloatSweepExecutor} from "@float/FloatSweepExecutor.sol";
import {IUniversalRouter} from "@float/interfaces/IUniversalRouter.sol";
import {IPermissionedPositionManager} from "@float/interfaces/IPermissionedPositionManager.sol";

/// @notice Base fixture: forks Sepolia, stands up the full Float venue against the
///         live Uniswap v4 Permissioned Pools deployment, seeds pool liquidity,
///         and prepares one verified business account.
abstract contract ForkVenueTest is Test {
    // Sepolia — Uniswap v4 Permissioned Pools.
    address internal constant FACTORY = 0xE6B0d96919334C33d06266d1420F97f6f434fA2B;
    address internal constant POSM = 0xf99D553912084c99F6299291b75Fe9B7119Aa1A7;
    address internal constant HOOKS = 0x51247E2291d290d17C08813A175AC86465EdE8c0;
    address internal constant UNIVERSAL_ROUTER = 0x54C707Df83f03bc9cA64ED2CcF9C99B63FD854b7;
    address internal constant V4_QUOTER = 0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227;
    address internal constant MIXED_QUOTER = 0x4745F77b56a0E2294426E3936dc4Fab68d9543Cd;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;

    address internal admin = makeAddr("admin");
    address internal oracle = makeAddr("oracle");
    address internal policySync = makeAddr("policySync");
    address internal treasury = makeAddr("treasury");
    address internal lp = makeAddr("lp");
    address internal biz = makeAddr("biz");

    FloatComplianceRegistry internal registry;
    FloatAllowlistChecker internal checker;
    FloatPolicyView internal policyView;
    FloatYieldReserve internal reserve;
    FloatUSTB internal ustb;
    FloatSweepExecutor internal executor;

    address internal adapter;
    address internal poolManager;

    uint256 internal constant BUFFER = 2_000e6;
    uint256 internal constant MAX_SWEEP = 10_000e6;

    function setUp() public virtual {
        // Opt-in: these hit a live Sepolia RPC. Run with `FORK_TESTS=1 forge test`.
        if (vm.envOr("FORK_TESTS", uint256(0)) == 0) {
            vm.skip(true);
            return;
        }
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string("https://ethereum-sepolia-rpc.publicnode.com"));
        uint256 forkBlock = vm.envOr("SEPOLIA_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, forkBlock);

        poolManager = IPermissionsAdapterFactory(FACTORY).POOL_MANAGER();

        _deployCore();
        _deployVenue();
        _seedLiquidity();
        _prepareBusiness();
    }

    // ── core ─────────────────────────────────────────────────────────────────

    function _deployCore() internal {
        registry = new FloatComplianceRegistry(admin, oracle);
        checker = new FloatAllowlistChecker(IFloatComplianceRegistry(address(registry)), lp);
        policyView = new FloatPolicyView(admin, policySync);
        reserve = new FloatYieldReserve(IERC20(USDC), admin);
        ustb = new FloatUSTB(IERC20(USDC), IFloatYieldReserve(address(reserve)), treasury, admin, 450, 1000);
        vm.prank(admin);
        reserve.setVault(address(ustb));

        deal(USDC, address(this), 500_000e6);
        IERC20(USDC).approve(address(reserve), type(uint256).max);
        reserve.fund(200_000e6);
    }

    // ── venue ────────────────────────────────────────────────────────────────

    function _deployVenue() internal {
        vm.startPrank(admin);
        adapter = IPermissionsAdapterFactory(FACTORY)
            .createPermissionsAdapter(IERC20(address(ustb)), admin, IAllowlistChecker(address(checker)));

        // seed + verify: admin mints a sliver of fUSTB into the adapter
        deal(USDC, admin, 1e6);
        IERC20(USDC).approve(address(ustb), 1e6);
        uint256 shares = ustb.deposit(1e6, admin);
        IERC20(address(ustb)).approve(adapter, shares);
        IPermissionsAdapter(adapter).depositForVerification(shares);
        IPermissionsAdapterFactory(FACTORY).verifyPermissionsAdapter(adapter);

        IPermissionsAdapter(adapter).updateAllowedWrapper(POSM, true);
        IPermissionsAdapter(adapter).updateAllowedWrapper(UNIVERSAL_ROUTER, true);
        IPermissionsAdapter(adapter).updateAllowedWrapper(V4_QUOTER, true);
        IPermissionsAdapter(adapter).updateAllowedWrapper(MIXED_QUOTER, true);
        IPermissionsAdapter(adapter).updateAllowedHook(IHooks(HOOKS), true);
        IPermissionsAdapter(adapter).updateSwappingEnabled(true);
        vm.stopPrank();

        IPoolManager(poolManager).initialize(_poolKey(), _initialSqrtPriceX96());

        executor = new FloatSweepExecutor(
            FloatSweepExecutor.Wiring({
                usdc: IERC20(USDC),
                floatUstb: IERC20(address(ustb)),
                adapter: adapter,
                router: IUniversalRouter(UNIVERSAL_ROUTER),
                permit2: PERMIT2,
                registry: IFloatComplianceRegistry(address(registry)),
                policyView: policyView,
                fee: FEE,
                tickSpacing: TICK_SPACING,
                hooks: HOOKS
            })
        );

        vm.prank(oracle);
        registry.setAttestation(
            address(executor), IFloatComplianceRegistry.KycStatus.Verified, false, 0, bytes32("float-executor")
        );
    }

    // ── liquidity ────────────────────────────────────────────────────────────

    function _seedLiquidity() internal {
        // Deep full-range liquidity so test swaps see negligible price impact.
        deal(USDC, lp, 12_000_000e6);
        vm.startPrank(lp);
        IERC20(USDC).approve(address(ustb), type(uint256).max);
        ustb.deposit(6_000_000e6, lp);

        // Permit2 plumbing for the position manager.
        IERC20(USDC).approve(PERMIT2, type(uint256).max);
        IERC20(address(ustb)).approve(PERMIT2, type(uint256).max);
        IAllowanceTransfer(PERMIT2).approve(USDC, POSM, type(uint160).max, type(uint48).max);
        IAllowanceTransfer(PERMIT2).approve(address(ustb), POSM, type(uint160).max, type(uint48).max);

        (int24 tickLower, int24 tickUpper) = _fullRange();
        uint160 sqrtP = _initialSqrtPriceX96();

        bool usdcIsC0 = uint160(USDC) < uint160(adapter);
        // Provide ~5M USDC and the matching fUSTB (1e3 base-unit ratio).
        uint256 usdcAmt = 5_000_000e6;
        uint256 ustbAmt = 5_000_000e6 * 1e3;
        (uint256 amt0, uint256 amt1) = usdcIsC0 ? (usdcAmt, ustbAmt) : (ustbAmt, usdcAmt);

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP, TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), amt0, amt1
        );

        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            _poolKey(), tickLower, tickUpper, liquidity, type(uint128).max, type(uint128).max, lp, bytes("")
        );
        params[1] = abi.encode(_poolKey().currency0, _poolKey().currency1);

        IPermissionedPositionManager(POSM).modifyLiquidities(abi.encode(actions, params), block.timestamp + 1);
        vm.stopPrank();
    }

    // ── business ─────────────────────────────────────────────────────────────

    function _prepareBusiness() internal {
        vm.prank(oracle);
        registry.setAttestation(biz, IFloatComplianceRegistry.KycStatus.Verified, false, 0, bytes32("biz"));
        vm.prank(policySync);
        policyView.setPolicy(biz, uint128(BUFFER), uint128(MAX_SWEEP));
        deal(USDC, biz, 50_000e6);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _poolKey() internal view returns (PoolKey memory) {
        (address c0, address c1) = uint160(USDC) < uint160(adapter) ? (USDC, adapter) : (adapter, USDC);
        return PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(HOOKS)
        });
    }

    function _initialSqrtPriceX96() internal view returns (uint160) {
        bool usdcIsC0 = uint160(USDC) < uint160(adapter);
        (uint256 amt1, uint256 amt0) = usdcIsC0 ? (uint256(1e9), uint256(1e6)) : (uint256(1e6), uint256(1e9));
        return uint160(Math.sqrt(Math.mulDiv(amt1, 1 << 192, amt0)));
    }

    function _fullRange() internal pure returns (int24 lower, int24 upper) {
        lower = TickMath.minUsableTick(TICK_SPACING);
        upper = TickMath.maxUsableTick(TICK_SPACING);
    }
}
