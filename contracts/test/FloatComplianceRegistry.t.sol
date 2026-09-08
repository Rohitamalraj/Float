// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {FloatComplianceRegistry} from "@float/FloatComplianceRegistry.sol";
import {IFloatComplianceRegistry} from "@float/interfaces/IFloatComplianceRegistry.sol";

contract FloatComplianceRegistryTest is Test {
    FloatComplianceRegistry internal reg;

    address internal admin = makeAddr("admin");
    address internal oracle = makeAddr("oracle");
    address internal biz = makeAddr("biz");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        reg = new FloatComplianceRegistry(admin, oracle);
    }

    function test_constructor_grantsRoles() public view {
        assertTrue(reg.hasRole(reg.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(reg.hasRole(reg.COMPLIANCE_ORACLE_ROLE(), oracle));
    }

    function test_constructor_revertsOnZero() public {
        vm.expectRevert(IFloatComplianceRegistry.ZeroAccount.selector);
        new FloatComplianceRegistry(address(0), oracle);
    }

    function test_setAttestation_verified() public {
        vm.prank(oracle);
        reg.setAttestation(biz, IFloatComplianceRegistry.KycStatus.Verified, true, 0, bytes32("ustb-1"));

        assertTrue(reg.isVerified(biz));
        assertTrue(reg.isAccredited(biz));

        IFloatComplianceRegistry.Attestation memory a = reg.attestationOf(biz);
        assertEq(uint8(a.status), uint8(IFloatComplianceRegistry.KycStatus.Verified));
        assertEq(a.verifiedAt, uint64(block.timestamp));
        assertEq(a.allowlistId, bytes32("ustb-1"));
    }

    function test_setAttestation_onlyOracle() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, reg.COMPLIANCE_ORACLE_ROLE()
            )
        );
        vm.prank(stranger);
        reg.setAttestation(biz, IFloatComplianceRegistry.KycStatus.Verified, false, 0, bytes32(0));
    }

    function test_expiry_isRespected() public {
        uint64 exp = uint64(block.timestamp + 30 days);
        vm.prank(oracle);
        reg.setAttestation(biz, IFloatComplianceRegistry.KycStatus.Verified, false, exp, bytes32(0));

        assertTrue(reg.isVerified(biz));
        vm.warp(exp);
        assertFalse(reg.isVerified(biz));
    }

    function test_setAttestation_revertsOnPastExpiry() public {
        vm.warp(1_000_000);
        vm.prank(oracle);
        vm.expectRevert(IFloatComplianceRegistry.ExpiryInPast.selector);
        reg.setAttestation(
            biz, IFloatComplianceRegistry.KycStatus.Verified, false, uint64(block.timestamp - 1), bytes32(0)
        );
    }

    function test_revoke_clearsVerification() public {
        vm.startPrank(oracle);
        reg.setAttestation(biz, IFloatComplianceRegistry.KycStatus.Verified, true, 0, bytes32(0));
        reg.revoke(biz);
        vm.stopPrank();

        assertFalse(reg.isVerified(biz));
        assertFalse(reg.isAccredited(biz));
        assertEq(uint8(reg.attestationOf(biz).status), uint8(IFloatComplianceRegistry.KycStatus.Revoked));
    }

    function test_pendingIsNotVerified() public {
        vm.prank(oracle);
        reg.setAttestation(biz, IFloatComplianceRegistry.KycStatus.Pending, false, 0, bytes32(0));
        assertFalse(reg.isVerified(biz));
    }

    function testFuzz_isAccredited_impliesVerified(bool accredited, uint8 statusRaw) public {
        IFloatComplianceRegistry.KycStatus status = IFloatComplianceRegistry.KycStatus(bound(statusRaw, 0, 4));
        vm.prank(oracle);
        reg.setAttestation(biz, status, accredited, 0, bytes32(0));
        if (reg.isAccredited(biz)) {
            assertTrue(reg.isVerified(biz));
            assertTrue(accredited);
        }
    }
}
