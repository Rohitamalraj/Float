// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ForkVenueTest} from "./ForkVenue.t.sol";
import {IFloatSweepExecutor} from "@float/interfaces/IFloatSweepExecutor.sol";
import {IFloatComplianceRegistry} from "@float/interfaces/IFloatComplianceRegistry.sol";
import {IFloatPolicyView} from "@float/interfaces/IFloatPolicyView.sol";

/// @notice The core end-to-end claim: an agent, acting only through
///         FloatSweepExecutor, can move a business's USDC in and out of the
///         yield position through the real permissioned pool — and nothing else.
contract SweepRoundTripTest is ForkVenueTest {
    function test_sweepIn_parksUsdcIntoFustb() public {
        uint256 usdcBefore = IERC20(USDC).balanceOf(biz);
        assertEq(IERC20(address(ustb)).balanceOf(biz), 0);

        vm.startPrank(biz);
        IERC20(USDC).approve(address(executor), 6_000e6);
        executor.sweepIn(6_000e6, 0);
        vm.stopPrank();

        assertEq(IERC20(USDC).balanceOf(biz), usdcBefore - 6_000e6, "USDC leg");
        uint256 fustb = IERC20(address(ustb)).balanceOf(biz);
        assertGt(fustb, 0, "received fUSTB");
        // ~1 USDC : 1 share of value, 9-decimal shares -> expect within 2% of 6_000 * 1e3 units.
        assertApproxEqRel(fustb, uint256(6_000e6) * 1e3, 0.02e18);
        // The executor is a pure pass-through — it never retains funds.
        assertEq(IERC20(USDC).balanceOf(address(executor)), 0);
        assertEq(IERC20(address(ustb)).balanceOf(address(executor)), 0);
    }

    function test_sweepOut_restoresUsdc() public {
        vm.startPrank(biz);
        IERC20(USDC).approve(address(executor), 6_000e6);
        executor.sweepIn(6_000e6, 0);

        uint256 fustb = IERC20(address(ustb)).balanceOf(biz);
        uint256 usdcMid = IERC20(USDC).balanceOf(biz);

        IERC20(address(ustb)).approve(address(executor), fustb);
        executor.sweepOut(fustb, 0);
        vm.stopPrank();

        assertEq(IERC20(address(ustb)).balanceOf(biz), 0, "position closed");
        uint256 recovered = IERC20(USDC).balanceOf(biz) - usdcMid;
        // Round-trip through a 0.3% pool twice -> expect to get back most of the 6k.
        assertApproxEqRel(recovered, 6_000e6, 0.03e18);
        assertEq(IERC20(USDC).balanceOf(address(executor)), 0);
    }

    function test_sweepIn_revertsOverPolicyCap() public {
        vm.startPrank(biz);
        IERC20(USDC).approve(address(executor), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(IFloatSweepExecutor.ExceedsPolicyCap.selector, 20_000e6, MAX_SWEEP));
        executor.sweepIn(20_000e6, 0);
        vm.stopPrank();
    }

    function test_sweepIn_revertsForUnverifiedAccount() public {
        address stranger = makeAddr("stranger");
        deal(USDC, stranger, 10_000e6);
        vm.prank(policySync);
        policyView.setPolicy(stranger, uint128(BUFFER), uint128(MAX_SWEEP));

        vm.startPrank(stranger);
        IERC20(USDC).approve(address(executor), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(IFloatSweepExecutor.NotVerified.selector, stranger));
        executor.sweepIn(1_000e6, 0);
        vm.stopPrank();
    }

    function test_sweepIn_revertsAfterComplianceRevoked() public {
        vm.prank(oracle);
        registry.revoke(biz);

        vm.startPrank(biz);
        IERC20(USDC).approve(address(executor), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(IFloatSweepExecutor.NotVerified.selector, biz));
        executor.sweepIn(1_000e6, 0);
        vm.stopPrank();
    }

    function test_sweepIn_revertsWhenPolicyUnset() public {
        address fresh = makeAddr("freshBiz");
        deal(USDC, fresh, 10_000e6);
        vm.prank(oracle);
        registry.setAttestation(fresh, IFloatComplianceRegistry.KycStatus.Verified, false, 0, bytes32(0));

        vm.startPrank(fresh);
        IERC20(USDC).approve(address(executor), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(IFloatPolicyView.PolicyNotSet.selector, fresh));
        executor.sweepIn(1_000e6, 0);
        vm.stopPrank();
    }
}
