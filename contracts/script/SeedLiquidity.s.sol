// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {Config} from "./Config.sol";
import {FloatUSTB} from "@float/FloatUSTB.sol";
import {IPermissionedPositionManager} from "@float/interfaces/IPermissionedPositionManager.sol";

/// @notice Seeds the live FloatUSTB/USDC Permissioned Pool with a single
///         full-range position. Run once after `DeployVenue`, before opening the
///         venue to real business sweeps. The Phase 1 fork test already proves
///         this mint path against live Sepolia contracts; this is the standalone
///         operational version.
///
/// Reads `deployments/<chainId>.core.json` (`.usdc`) and
/// `deployments/<chainId>.venue.json` (`.floatUstb`, `.permissionsAdapter`,
/// `.fee`, `.tickSpacing`).
///
/// Required env: DEPLOYER_PRIVATE_KEY.
/// Optional env:
///   SEED_USDC          USDC placed on the USDC side of the position (default 5_000e6).
///   SEED_DEPOSIT_SLACK_BPS  extra USDC deposited to the vault for shares (default 2000 = 20%).
///   SEED_DEADLINE_SECONDS   mint deadline offset (default 300).
///
/// The deployer must hold roughly `SEED_USDC * (2 + slack)` USDC: one `SEED_USDC`
/// for the position's USDC leg and `SEED_USDC * (1 + slack)` deposited into
/// FloatUSTB to obtain the fUSTB leg (share price ≈ 1.00, 3-decimal offset).
contract SeedLiquidity is Config {
    struct Result {
        bytes32 poolId;
        uint128 liquidity;
        uint256 usdcProvided;
        uint256 ustbProvided;
    }

    function run() external returns (Result memory r) {
        UniswapAddrs memory u = _uniswap();

        string memory core = vm.readFile(_deploymentsPath("core"));
        string memory venue = vm.readFile(_deploymentsPath("venue"));
        address usdc = vm.parseJsonAddress(core, ".usdc");
        address floatUstb = vm.parseJsonAddress(venue, ".floatUstb");
        address adapter = vm.parseJsonAddress(venue, ".permissionsAdapter");
        uint24 fee = uint24(vm.parseJsonUint(venue, ".fee"));
        int24 tickSpacing = int24(vm.parseJsonInt(venue, ".tickSpacing"));

        uint256 seedUsdc = vm.envOr("SEED_USDC", uint256(5_000e6));
        uint256 slackBps = vm.envOr("SEED_DEPOSIT_SLACK_BPS", uint256(2_000));
        uint256 deadline = block.timestamp + vm.envOr("SEED_DEADLINE_SECONDS", uint256(300));

        uint256 depositUsdc = seedUsdc + (seedUsdc * slackBps) / 10_000;
        uint256 targetUstb = seedUsdc * 1e3; // 6-dp asset + 3-dp offset

        uint256 pk = _deployerKey();
        address deployer = vm.addr(pk);

        PoolKey memory key = _poolKey(usdc, adapter, u.permissionedHooks, fee, tickSpacing);
        (int24 tickLower, int24 tickUpper) = _fullRange(tickSpacing);
        uint160 sqrtP = _sqrtPrice(usdc, adapter);

        bool usdcIsC0 = uint160(usdc) < uint160(adapter);
        (uint256 amt0, uint256 amt1) = usdcIsC0 ? (seedUsdc, targetUstb) : (targetUstb, seedUsdc);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP, TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), amt0, amt1
        );
        require(liquidity > 0, "computed zero liquidity - check SEED_USDC / pool price");

        vm.startBroadcast(pk);

        // fUSTB leg: mint shares from USDC.
        IERC20(usdc).approve(floatUstb, depositUsdc);
        uint256 shares = FloatUSTB(floatUstb).deposit(depositUsdc, deployer);
        require(shares >= targetUstb, "insufficient shares minted - raise SEED_DEPOSIT_SLACK_BPS");

        // Permit2 plumbing for the position manager.
        IERC20(usdc).approve(u.permit2, type(uint256).max);
        IERC20(floatUstb).approve(u.permit2, type(uint256).max);
        IAllowanceTransfer(u.permit2).approve(usdc, u.permissionedPositionManager, type(uint160).max, type(uint48).max);
        IAllowanceTransfer(u.permit2)
            .approve(floatUstb, u.permissionedPositionManager, type(uint160).max, type(uint48).max);

        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] =
            abi.encode(key, tickLower, tickUpper, liquidity, type(uint128).max, type(uint128).max, deployer, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);

        IPermissionedPositionManager(u.permissionedPositionManager)
            .modifyLiquidities(abi.encode(actions, params), deadline);

        vm.stopBroadcast();

        r = Result({
            poolId: keccak256(abi.encode(key)), liquidity: liquidity, usdcProvided: seedUsdc, ustbProvided: targetUstb
        });
        console2.log("pool seeded");
        console2.logBytes32(r.poolId);
        console2.log("liquidity     ", r.liquidity);
        console2.log("usdc provided ", r.usdcProvided);
        console2.log("fUSTB provided", r.ustbProvided);
    }

    function _poolKey(address usdc, address adapter, address hooks, uint24 fee, int24 tickSpacing)
        internal
        pure
        returns (PoolKey memory)
    {
        (address c0, address c1) = uint160(usdc) < uint160(adapter) ? (usdc, adapter) : (adapter, usdc);
        return PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(hooks)
        });
    }

    /// @dev Matches `DeployVenue._initializePool`: 1e6 USDC ≈ 1e9 fUSTB units.
    function _sqrtPrice(address usdc, address adapter) internal pure returns (uint160) {
        bool usdcIsC0 = uint160(usdc) < uint160(adapter);
        (uint256 amt1, uint256 amt0) = usdcIsC0 ? (uint256(1e9), uint256(1e6)) : (uint256(1e6), uint256(1e9));
        return uint160(Math.sqrt(Math.mulDiv(amt1, 1 << 192, amt0)));
    }

    function _fullRange(int24 tickSpacing) internal pure returns (int24 lower, int24 upper) {
        lower = TickMath.minUsableTick(tickSpacing);
        upper = TickMath.maxUsableTick(tickSpacing);
    }
}
