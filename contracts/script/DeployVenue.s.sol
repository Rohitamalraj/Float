// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {
    IPermissionsAdapterFactory
} from "@uniswap/v4-periphery/src/hooks/permissionedPools/interfaces/IPermissionsAdapterFactory.sol";
import {
    IPermissionsAdapter
} from "@uniswap/v4-periphery/src/hooks/permissionedPools/interfaces/IPermissionsAdapter.sol";
import {IAllowlistChecker} from "@uniswap/v4-periphery/src/hooks/permissionedPools/interfaces/IAllowlistChecker.sol";

import {Config} from "./Config.sol";
import {FloatUSTB} from "@float/FloatUSTB.sol";
import {FloatComplianceRegistry} from "@float/FloatComplianceRegistry.sol";
import {IFloatComplianceRegistry} from "@float/interfaces/IFloatComplianceRegistry.sol";
import {IFloatPolicyView} from "@float/interfaces/IFloatPolicyView.sol";
import {IUniversalRouter} from "@float/interfaces/IUniversalRouter.sol";
import {FloatSweepExecutor} from "@float/FloatSweepExecutor.sol";

/// @notice Wires FloatUSTB into a Uniswap v4 Permissioned Pool, deploys the
///         FloatSweepExecutor, and registers the executor as a verified swapper.
///
/// Reads `deployments/<chainId>.core.json` for the core addresses.
///
/// Required env: DEPLOYER_PRIVATE_KEY, COMPLIANCE_ORACLE_PRIVATE_KEY.
/// Optional env: FLOAT_POOL_FEE (3000), FLOAT_POOL_TICK_SPACING (60),
///   FLOAT_VERIFICATION_USDC (1e6) — small deposit used to seed adapter verification.
contract DeployVenue is Config {
    uint24 internal poolFee;
    int24 internal tickSpacing;

    struct VenueDeployment {
        address floatUstb;
        address permissionsAdapter;
        address poolManager;
        address sweepExecutor;
        bytes32 poolId;
        uint24 fee;
        int24 tickSpacing;
    }

    function run() external returns (VenueDeployment memory v) {
        UniswapAddrs memory u = _uniswap();
        poolFee = uint24(vm.envOr("FLOAT_POOL_FEE", uint256(3000)));
        tickSpacing = int24(int256(vm.envOr("FLOAT_POOL_TICK_SPACING", uint256(60))));

        string memory core = vm.readFile(_deploymentsPath("core"));
        address usdc = vm.parseJsonAddress(core, ".usdc");
        address floatUstb = vm.parseJsonAddress(core, ".floatUstb");
        address registry = vm.parseJsonAddress(core, ".complianceRegistry");
        address checker = vm.parseJsonAddress(core, ".allowlistChecker");
        address policyView = vm.parseJsonAddress(core, ".policyView");

        uint256 pk = _deployerKey();
        address deployer = vm.addr(pk);
        address poolManager = IPermissionsAdapterFactory(u.permissionsAdapterFactory).POOL_MANAGER();

        vm.startBroadcast(pk);

        address adapter = _envOrAddr("FLOAT_PERMISSIONS_ADAPTER_ADDRESS", address(0));
        if (adapter == address(0)) {
            adapter = IPermissionsAdapterFactory(u.permissionsAdapterFactory)
                .createPermissionsAdapter(IERC20(floatUstb), deployer, IAllowlistChecker(checker));
            _seedAndVerify(u, floatUstb, adapter, usdc, deployer);
        }

        _authorizeWrappers(adapter, u);

        PoolKey memory key = _poolKey(usdc, adapter, u.permissionedHooks);
        _initializePool(poolManager, key, usdc, adapter);

        FloatSweepExecutor executor = new FloatSweepExecutor(
            FloatSweepExecutor.Wiring({
                usdc: IERC20(usdc),
                floatUstb: IERC20(floatUstb),
                adapter: adapter,
                router: IUniversalRouter(u.universalRouter),
                permit2: u.permit2,
                registry: IFloatComplianceRegistry(registry),
                policyView: IFloatPolicyView(policyView),
                fee: poolFee,
                tickSpacing: tickSpacing,
                hooks: u.permissionedHooks
            })
        );
        vm.stopBroadcast();

        // The executor must itself be an allowlisted swapper for the pool hook.
        vm.startBroadcast(vm.envUint("COMPLIANCE_ORACLE_PRIVATE_KEY"));
        FloatComplianceRegistry(registry)
            .setAttestation(
                address(executor), IFloatComplianceRegistry.KycStatus.Verified, false, 0, bytes32("float-executor")
            );
        vm.stopBroadcast();

        v = VenueDeployment({
            floatUstb: floatUstb,
            permissionsAdapter: adapter,
            poolManager: poolManager,
            sweepExecutor: address(executor),
            poolId: _poolId(key),
            fee: poolFee,
            tickSpacing: tickSpacing
        });
        _write(v);
        _log(v);
    }

    function _seedAndVerify(UniswapAddrs memory, address floatUstb, address adapter, address usdc, address deployer)
        internal
    {
        uint256 seed = vm.envOr("FLOAT_VERIFICATION_USDC", uint256(1e6));
        IERC20(usdc).approve(floatUstb, seed);
        uint256 shares = FloatUSTB(floatUstb).deposit(seed, deployer);
        IERC20(floatUstb).approve(adapter, shares);
        IPermissionsAdapter(adapter).depositForVerification(shares);
        IPermissionsAdapterFactory(_uniswap().permissionsAdapterFactory).verifyPermissionsAdapter(adapter);
    }

    function _authorizeWrappers(address adapter, UniswapAddrs memory u) internal {
        IPermissionsAdapter a = IPermissionsAdapter(adapter);
        a.updateAllowedWrapper(u.permissionedPositionManager, true);
        a.updateAllowedWrapper(u.universalRouter, true);
        a.updateAllowedWrapper(u.v4Quoter, true);
        a.updateAllowedWrapper(u.mixedRouteQuoterV2, true);
        a.updateAllowedHook(IHooks(u.permissionedHooks), true);
        a.updateSwappingEnabled(true);
    }

    function _poolKey(address usdc, address adapter, address hooks) internal view returns (PoolKey memory) {
        (address c0, address c1) = uint160(usdc) < uint160(adapter) ? (usdc, adapter) : (adapter, usdc);
        return PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: poolFee,
            tickSpacing: tickSpacing,
            hooks: IHooks(hooks)
        });
    }

    /// @dev Initial price for a ~1.00 share price: 1e6 USDC ≈ 1e9 fUSTB units
    ///      (6-decimal asset + 3-decimal offset). Idempotent — a re-run whose
    ///      pool already exists is tolerated.
    function _initializePool(address poolManager, PoolKey memory key, address usdc, address adapter) internal {
        bool usdcIsC0 = uint160(usdc) < uint160(adapter);
        // price = amount(currency1) / amount(currency0)
        (uint256 amt1, uint256 amt0) = usdcIsC0 ? (uint256(1e9), uint256(1e6)) : (uint256(1e6), uint256(1e9));
        uint160 sqrtPriceX96 = uint160(Math.sqrt(Math.mulDiv(amt1, 1 << 192, amt0)));
        try IPoolManager(poolManager).initialize(key, sqrtPriceX96) {
            console2.log("pool initialized, sqrtPriceX96:", sqrtPriceX96);
        } catch {
            console2.log("pool.initialize reverted (already initialized?) - continuing");
        }
    }

    function _poolId(PoolKey memory key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }

    function _write(VenueDeployment memory v) internal {
        string memory json = "venue";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "floatUstb", v.floatUstb);
        vm.serializeAddress(json, "permissionsAdapter", v.permissionsAdapter);
        vm.serializeAddress(json, "poolManager", v.poolManager);
        vm.serializeAddress(json, "sweepExecutor", v.sweepExecutor);
        vm.serializeBytes32(json, "poolId", v.poolId);
        vm.serializeUint(json, "fee", v.fee);
        string memory out = vm.serializeInt(json, "tickSpacing", v.tickSpacing);
        vm.writeJson(out, _deploymentsPath("venue"));
    }

    function _log(VenueDeployment memory v) internal pure {
        console2.log("PermissionsAdapter ", v.permissionsAdapter);
        console2.log("PoolManager        ", v.poolManager);
        console2.log("FloatSweepExecutor ", v.sweepExecutor);
        console2.logBytes32(v.poolId);
    }
}
