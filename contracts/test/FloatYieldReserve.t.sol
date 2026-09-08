// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {FloatYieldReserve} from "@float/FloatYieldReserve.sol";
import {IFloatYieldReserve} from "@float/interfaces/IFloatYieldReserve.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract FloatYieldReserveTest is Test {
    FloatYieldReserve internal reserve;
    MockERC20 internal usdc;

    address internal owner = makeAddr("owner");
    address internal vault = makeAddr("vault");
    address internal funder = makeAddr("funder");

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        reserve = new FloatYieldReserve(IERC20(address(usdc)), owner);
        vm.prank(owner);
        reserve.setVault(vault);

        usdc.mint(funder, 1_000_000e6);
        vm.startPrank(funder);
        usdc.approve(address(reserve), type(uint256).max);
        reserve.fund(500_000e6);
        vm.stopPrank();
    }

    function test_fundIncreasesAvailable() public view {
        assertEq(reserve.available(), 500_000e6);
    }

    function test_setVault_onlyOnce() public {
        vm.prank(owner);
        vm.expectRevert(IFloatYieldReserve.VaultAlreadySet.selector);
        reserve.setVault(makeAddr("other"));
    }

    function test_pull_onlyVault() public {
        vm.expectRevert(abi.encodeWithSelector(IFloatYieldReserve.NotVault.selector, address(this)));
        reserve.pull(1e6, address(this));
    }

    function test_pull_capsAtAvailable() public {
        vm.prank(vault);
        uint256 sent = reserve.pull(9_000_000e6, vault);
        assertEq(sent, 500_000e6);
        assertEq(usdc.balanceOf(vault), 500_000e6);
        assertEq(reserve.available(), 0);
    }

    function test_pull_exact() public {
        vm.prank(vault);
        uint256 sent = reserve.pull(123e6, vault);
        assertEq(sent, 123e6);
        assertEq(reserve.available(), 500_000e6 - 123e6);
    }

    function test_withdrawReserve_onlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        reserve.withdrawReserve(1e6, address(this));

        vm.prank(owner);
        reserve.withdrawReserve(100e6, owner);
        assertEq(usdc.balanceOf(owner), 100e6);
    }
}
