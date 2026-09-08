// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {FloatPolicyView} from "@float/FloatPolicyView.sol";
import {IFloatPolicyView} from "@float/interfaces/IFloatPolicyView.sol";

contract FloatPolicyViewTest is Test {
    FloatPolicyView internal pv;
    address internal admin = makeAddr("admin");
    address internal sync = makeAddr("sync");
    address internal biz = makeAddr("biz");

    function setUp() public {
        pv = new FloatPolicyView(admin, sync);
    }

    function test_setAndReadPolicy() public {
        vm.prank(sync);
        pv.setPolicy(biz, 2_000e6, 10_000e6);

        assertEq(pv.bufferAmount(biz), 2_000e6);
        assertEq(pv.maxSweepPerTx(biz), 10_000e6);

        IFloatPolicyView.AccountPolicy memory p = pv.policyOf(biz);
        assertTrue(p.set);
        assertEq(p.bufferAmount, 2_000e6);
    }

    function test_unsetPolicyReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IFloatPolicyView.PolicyNotSet.selector, biz));
        pv.maxSweepPerTx(biz);
    }

    function test_clearPolicy() public {
        vm.startPrank(sync);
        pv.setPolicy(biz, 1e6, 2e6);
        pv.clearPolicy(biz);
        vm.stopPrank();
        assertFalse(pv.policyOf(biz).set);
        vm.expectRevert(abi.encodeWithSelector(IFloatPolicyView.PolicyNotSet.selector, biz));
        pv.bufferAmount(biz);
    }

    function test_onlySyncRole() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), pv.POLICY_SYNC_ROLE()
            )
        );
        pv.setPolicy(biz, 1, 1);
    }

    function test_zeroAccountReverts() public {
        vm.prank(sync);
        vm.expectRevert(IFloatPolicyView.ZeroAccount.selector);
        pv.setPolicy(address(0), 1, 1);
    }
}
