// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Config} from "./Config.sol";
import {FloatComplianceRegistry} from "@float/FloatComplianceRegistry.sol";
import {IFloatComplianceRegistry} from "@float/interfaces/IFloatComplianceRegistry.sol";
import {FloatAllowlistChecker} from "@float/FloatAllowlistChecker.sol";
import {FloatPolicyView} from "@float/FloatPolicyView.sol";
import {FloatYieldReserve} from "@float/FloatYieldReserve.sol";
import {IFloatYieldReserve} from "@float/interfaces/IFloatYieldReserve.sol";
import {FloatUSTB} from "@float/FloatUSTB.sol";

/// @notice Deploys the chain-agnostic Float core: compliance registry, allowlist
///         checker, policy view, yield reserve, and the FloatUSTB vault. Does NOT
///         touch Uniswap — see `DeployVenue.s.sol` for that.
///
/// Required env: DEPLOYER_PRIVATE_KEY, USDC_ADDRESS, FLOAT_ADMIN_ADDRESS,
///   FLOAT_TREASURY_ADDRESS, COMPLIANCE_ORACLE_ADDRESS, POLICY_SYNC_ADDRESS,
///   LIQUIDITY_MANAGER_ADDRESS.
/// Optional env: FLOAT_GROSS_YIELD_BPS (default 450), FLOAT_SPREAD_SHARE_BPS (default 1000).
contract DeployCore is Config {
    struct CoreDeployment {
        address usdc;
        address complianceRegistry;
        address allowlistChecker;
        address policyView;
        address yieldReserve;
        address floatUstb;
    }

    function run() external returns (CoreDeployment memory d) {
        uint256 pk = _deployerKey();
        address usdc = vm.envAddress("USDC_ADDRESS");
        address admin = vm.envAddress("FLOAT_ADMIN_ADDRESS");
        address treasury = vm.envAddress("FLOAT_TREASURY_ADDRESS");
        address oracle = vm.envAddress("COMPLIANCE_ORACLE_ADDRESS");
        address policySync = vm.envAddress("POLICY_SYNC_ADDRESS");
        address lpManager = vm.envAddress("LIQUIDITY_MANAGER_ADDRESS");
        uint16 grossBps = uint16(vm.envOr("FLOAT_GROSS_YIELD_BPS", uint256(450)));
        uint16 spreadBps = uint16(vm.envOr("FLOAT_SPREAD_SHARE_BPS", uint256(1000)));

        vm.startBroadcast(pk);
        address deployer = vm.addr(pk);

        FloatComplianceRegistry registry = new FloatComplianceRegistry(admin, oracle);
        FloatAllowlistChecker checker =
            new FloatAllowlistChecker(IFloatComplianceRegistry(address(registry)), lpManager);
        FloatPolicyView policyView = new FloatPolicyView(admin, policySync);

        // Reserve is owned by the deployer for setVault + initial funding, then
        // ownership is handed to the Float admin.
        FloatYieldReserve reserve = new FloatYieldReserve(IERC20(usdc), deployer);
        FloatUSTB ustb =
            new FloatUSTB(IERC20(usdc), IFloatYieldReserve(address(reserve)), treasury, admin, grossBps, spreadBps);
        reserve.setVault(address(ustb));
        reserve.transferOwnership(admin); // Ownable2Step: admin must accept

        vm.stopBroadcast();

        d = CoreDeployment({
            usdc: usdc,
            complianceRegistry: address(registry),
            allowlistChecker: address(checker),
            policyView: address(policyView),
            yieldReserve: address(reserve),
            floatUstb: address(ustb)
        });

        _write(d);
        _log(d);
    }

    function _write(CoreDeployment memory d) internal {
        string memory json = "core";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "usdc", d.usdc);
        vm.serializeAddress(json, "complianceRegistry", d.complianceRegistry);
        vm.serializeAddress(json, "allowlistChecker", d.allowlistChecker);
        vm.serializeAddress(json, "policyView", d.policyView);
        vm.serializeAddress(json, "yieldReserve", d.yieldReserve);
        string memory out = vm.serializeAddress(json, "floatUstb", d.floatUstb);
        vm.writeJson(out, _deploymentsPath("core"));
    }

    function _log(CoreDeployment memory d) internal pure {
        console2.log("FloatComplianceRegistry ", d.complianceRegistry);
        console2.log("FloatAllowlistChecker   ", d.allowlistChecker);
        console2.log("FloatPolicyView         ", d.policyView);
        console2.log("FloatYieldReserve       ", d.yieldReserve);
        console2.log("FloatUSTB               ", d.floatUstb);
    }
}
