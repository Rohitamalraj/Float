// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Config} from "./Config.sol";

/// @dev Minimal interface for the ENS v2 (beta) ETHRegistrar — `subregistry` and
///      `resolver` are typed `address` here (encode identically to the real
///      `IRegistry`/resolver interface types) so this script needs no ENS
///      contracts dependency.
interface IEthRegistrar {
    function makeCommitment(
        string calldata label,
        address owner,
        bytes32 secret,
        address subregistry,
        address resolver,
        uint64 duration,
        bytes32 referrer
    ) external pure returns (bytes32);

    function commit(bytes32 commitment) external;

    function register(
        string calldata label,
        address owner,
        bytes32 secret,
        address subregistry,
        address resolver,
        uint64 duration,
        address paymentToken,
        bytes32 referrer
    ) external returns (uint256 tokenId);

    function getRegisterPrice(string calldata label, uint64 duration, address paymentToken)
        external
        view
        returns (uint256 base, uint256 premium);

    function isAvailable(string calldata label) external view returns (bool);
}

/// @notice One-time registration of Float's ENS v2 parent name (`float.eth` on the
///         Sepolia beta) via the real ETHRegistrar commit-reveal flow, paid in USDC
///         (the registrar accepts any ERC-20 as `paymentToken` — confirmed live:
///         `getRegisterPrice("float", 365 days, USDC)` returns ~8 USDC, 0 premium).
///
///         Two steps, run at least `MIN_COMMITMENT_AGE` (60s on this deployment)
///         apart — commit() cannot also register() in the same call because the
///         registrar enforces that minimum age on-chain:
///           forge script script/RegisterEnsParent.s.sol --sig "commit()"   --broadcast --rpc-url $SEPOLIA_RPC_URL
///           (wait >= 60s)
///           forge script script/RegisterEnsParent.s.sol --sig "register()" --broadcast --rpc-url $SEPOLIA_RPC_URL
///
/// Required env: DEPLOYER_PRIVATE_KEY (pays gas + the USDC fee),
///   ENS_PROVISIONER_ADDRESS (becomes the name's owner — the `provisioner` role
///   `packages/ens`'s `planParentSubregistry`/`planBusinessProvisioning` expect),
///   ENS_REGISTRAR_ADDRESS, USDC_ADDRESS.
/// Optional env: ENS_PARENT_LABEL (default "float"),
///   ENS_REGISTER_DURATION_SECONDS (default 31536000 = 1 year).
contract RegisterEnsParent is Config {
    function _registrar() internal view returns (IEthRegistrar) {
        return IEthRegistrar(vm.envAddress("ENS_REGISTRAR_ADDRESS"));
    }

    function _label() internal view returns (string memory) {
        return vm.envOr("ENS_PARENT_LABEL", string("float"));
    }

    function _owner() internal view returns (address) {
        return vm.envAddress("ENS_PROVISIONER_ADDRESS");
    }

    /// @dev Deterministic, not random — so `commit()` and `register()` (separate
    ///      broadcasts, no shared process state) agree on the same secret. Fine
    ///      for a one-off registration of a name with no market value; a name an
    ///      attacker actually wants would call for a random secret persisted
    ///      between the two steps instead.
    function _secret() internal view returns (bytes32) {
        return keccak256(abi.encodePacked("float-ens-parent-v1", _owner()));
    }

    function _duration() internal view returns (uint64) {
        return uint64(vm.envOr("ENS_REGISTER_DURATION_SECONDS", uint256(365 days)));
    }

    function commit() external {
        IEthRegistrar registrar = _registrar();
        require(registrar.isAvailable(_label()), "label not available");

        bytes32 commitment =
            registrar.makeCommitment(_label(), _owner(), _secret(), address(0), address(0), _duration(), bytes32(0));

        vm.startBroadcast(_deployerKey());
        registrar.commit(commitment);
        vm.stopBroadcast();

        console2.log('committed - wait >= 60s, then run --sig "register()"');
        console2.logBytes32(commitment);
    }

    function register() external {
        IEthRegistrar registrar = _registrar();
        address usdc = vm.envAddress("USDC_ADDRESS");
        (uint256 base, uint256 premium) = registrar.getRegisterPrice(_label(), _duration(), usdc);
        uint256 price = base + premium;

        vm.startBroadcast(_deployerKey());
        IERC20(usdc).approve(address(registrar), price);
        uint256 tokenId =
            registrar.register(_label(), _owner(), _secret(), address(0), address(0), _duration(), usdc, bytes32(0));
        vm.stopBroadcast();

        console2.log("registered! tokenId:");
        console2.log(tokenId);
        console2.log("price paid (USDC, 6dp):", price);
    }
}
