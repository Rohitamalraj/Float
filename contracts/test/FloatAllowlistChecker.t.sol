// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {
    PermissionFlag,
    PermissionFlags
} from "@uniswap/v4-periphery/src/hooks/permissionedPools/libraries/PermissionFlags.sol";
import {IAllowlistChecker} from "@uniswap/v4-periphery/src/hooks/permissionedPools/interfaces/IAllowlistChecker.sol";
import {FloatComplianceRegistry} from "@float/FloatComplianceRegistry.sol";
import {IFloatComplianceRegistry} from "@float/interfaces/IFloatComplianceRegistry.sol";
import {FloatAllowlistChecker} from "@float/FloatAllowlistChecker.sol";

contract FloatAllowlistCheckerTest is Test {
    FloatComplianceRegistry internal reg;
    FloatAllowlistChecker internal checker;

    address internal admin = makeAddr("admin");
    address internal oracle = makeAddr("oracle");
    address internal lp = makeAddr("lp");
    address internal executor = makeAddr("executor");
    address internal token = makeAddr("token");

    function setUp() public {
        reg = new FloatComplianceRegistry(admin, oracle);
        checker = new FloatAllowlistChecker(IFloatComplianceRegistry(address(reg)), lp);
    }

    function _flag(address a) internal view returns (bytes2) {
        return PermissionFlag.unwrap(checker.checkAllowlist(a, token));
    }

    function test_unverified_isNone() public view {
        assertEq(_flag(executor), PermissionFlag.unwrap(PermissionFlags.NONE));
    }

    function test_verified_getsSwapAllowed() public {
        vm.prank(oracle);
        reg.setAttestation(executor, IFloatComplianceRegistry.KycStatus.Verified, false, 0, bytes32(0));
        assertEq(_flag(executor), PermissionFlag.unwrap(PermissionFlags.SWAP_ALLOWED));
    }

    function test_lpManager_getsSwapAndLiquidity() public view {
        bytes2 expected = PermissionFlag.unwrap(PermissionFlags.SWAP_ALLOWED | PermissionFlags.LIQUIDITY_ALLOWED);
        assertEq(_flag(lp), expected);
    }

    function test_revokedLosesSwap() public {
        vm.startPrank(oracle);
        reg.setAttestation(executor, IFloatComplianceRegistry.KycStatus.Verified, false, 0, bytes32(0));
        reg.revoke(executor);
        vm.stopPrank();
        assertEq(_flag(executor), PermissionFlag.unwrap(PermissionFlags.NONE));
    }

    function test_supportsInterface() public view {
        assertTrue(checker.supportsInterface(type(IAllowlistChecker).interfaceId));
        assertTrue(checker.supportsInterface(type(IERC165).interfaceId));
        assertFalse(checker.supportsInterface(0xffffffff));
    }
}
