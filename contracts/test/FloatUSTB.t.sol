// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {FloatUSTB} from "@float/FloatUSTB.sol";
import {FloatYieldReserve} from "@float/FloatYieldReserve.sol";
import {IFloatYieldReserve} from "@float/interfaces/IFloatYieldReserve.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract FloatUSTBTest is Test {
    MockERC20 internal usdc;
    FloatYieldReserve internal reserve;
    FloatUSTB internal vault;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");
    address internal keeper = makeAddr("keeper");

    uint16 internal constant RATE_BPS = 450; // 4.5% gross
    uint16 internal constant SPREAD_BPS = 1000; // Float keeps 10% of yield

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        reserve = new FloatYieldReserve(IERC20(address(usdc)), owner);
        vault = new FloatUSTB(
            IERC20(address(usdc)), IFloatYieldReserve(address(reserve)), treasury, owner, RATE_BPS, SPREAD_BPS
        );
        vm.prank(owner);
        reserve.setVault(address(vault));

        usdc.mint(address(this), 10_000_000e6);
        usdc.approve(address(reserve), type(uint256).max);
        reserve.fund(1_000_000e6);

        usdc.mint(alice, 1_000_000e6);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _deposit(address who, uint256 assets) internal returns (uint256 shares) {
        vm.prank(who);
        shares = vault.deposit(assets, who);
    }

    function test_constructor_bounds() public {
        vm.expectRevert(abi.encodeWithSelector(FloatUSTB.RateTooHigh.selector, uint16(5001)));
        new FloatUSTB(IERC20(address(usdc)), IFloatYieldReserve(address(reserve)), treasury, owner, 5001, 0);

        vm.expectRevert(abi.encodeWithSelector(FloatUSTB.SpreadTooHigh.selector, uint16(10000)));
        new FloatUSTB(IERC20(address(usdc)), IFloatYieldReserve(address(reserve)), treasury, owner, 100, 10000);
    }

    function test_deposit_thenRedeemNoTime_isFlat() public {
        uint256 shares = _deposit(alice, 100_000e6);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);
        assertApproxEqAbs(out, 100_000e6, 2);
    }

    function test_yieldAccruesToShareholders_netOfSpread() public {
        uint256 aliceShares = _deposit(alice, 100_000e6);
        vm.warp(block.timestamp + 365 days);

        // View already reflects net pending yield: 4.5% gross, 10% to Float => 4.05% net.
        assertApproxEqAbs(vault.totalAssets(), 104_050e6, 1e3);

        vm.prank(keeper);
        vault.accrue();

        assertApproxEqAbs(usdc.balanceOf(address(vault)), 104_050e6, 1e3);
        assertApproxEqAbs(usdc.balanceOf(treasury), 450e6, 1e3);
        assertApproxEqAbs(reserve.available(), 1_000_000e6 - 4_500e6, 1e3);

        vm.prank(alice);
        uint256 out = vault.redeem(aliceShares, alice, alice);
        assertApproxEqAbs(out, 104_050e6, 1e3);
    }

    function test_yield_isCappedByReserveBalance() public {
        // Drain the reserve to a small amount.
        vm.prank(owner);
        reserve.withdrawReserve(1_000_000e6 - 1_000e6, owner);

        _deposit(alice, 100_000e6);
        vm.warp(block.timestamp + 365 days); // would owe 4500e6, only 1000e6 available

        vm.prank(keeper);
        vault.accrue();

        // pulled == 1000e6; spread == 10% of pulled.
        assertApproxEqAbs(usdc.balanceOf(treasury), 100e6, 1e3);
        assertEq(reserve.available(), 0);
        assertApproxEqAbs(usdc.balanceOf(address(vault)), 100_000e6 + 900e6, 1e3);
    }

    function test_secondDepositorDoesNotDiluteFirst() public {
        uint256 aliceShares = _deposit(alice, 100_000e6);
        vm.warp(block.timestamp + 182 days);

        address bob = makeAddr("bob");
        usdc.mint(bob, 100_000e6);
        vm.startPrank(bob);
        usdc.approve(address(vault), type(uint256).max);
        uint256 bobShares = vault.deposit(100_000e6, bob);
        vm.stopPrank();

        // Bob enters after accrual, so he gets fewer shares for the same assets.
        assertLt(bobShares, aliceShares);

        vm.warp(block.timestamp + 183 days);
        vm.prank(keeper);
        vault.accrue();

        vm.prank(alice);
        uint256 aliceOut = vault.redeem(aliceShares, alice, alice);
        vm.prank(bob);
        uint256 bobOut = vault.redeem(bobShares, bob, bob);

        assertGt(aliceOut, bobOut); // Alice was in longer
        assertGt(aliceOut, 100_000e6);
        assertGt(bobOut, 100_000e6 - 1e3);
    }

    function test_setYieldRate_onlyOwner_andSettlesFirst() public {
        _deposit(alice, 100_000e6);
        vm.warp(block.timestamp + 365 days);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        vault.setYieldRateBps(0);

        vm.prank(owner);
        vault.setYieldRateBps(0);

        // Yield up to the change was realised.
        assertApproxEqAbs(usdc.balanceOf(address(vault)), 104_050e6, 1e3);

        // No further yield after the rate goes to zero.
        vm.warp(block.timestamp + 365 days);
        vm.prank(keeper);
        vault.accrue();
        assertApproxEqAbs(usdc.balanceOf(address(vault)), 104_050e6, 1e3);
    }
}
