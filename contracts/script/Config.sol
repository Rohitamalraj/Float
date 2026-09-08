// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";

/// @notice Shared deployment configuration, sourced from environment variables
///         (see `.env.example`). Addresses default to Sepolia's Uniswap v4
///         Permissioned Pools deployment.
abstract contract Config is Script {
    struct UniswapAddrs {
        address permissionsAdapterFactory;
        address permissionedPositionManager;
        address permissionedHooks;
        address universalRouter;
        address v4Quoter;
        address mixedRouteQuoterV2;
        address permit2;
        address poolManager;
    }

    // Permit2 is canonical on every chain.
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function _uniswapSepolia() internal pure returns (UniswapAddrs memory u) {
        u.permissionsAdapterFactory = 0xE6B0d96919334C33d06266d1420F97f6f434fA2B;
        u.permissionedPositionManager = 0xf99D553912084c99F6299291b75Fe9B7119Aa1A7;
        u.permissionedHooks = 0x51247E2291d290d17C08813A175AC86465EdE8c0;
        u.universalRouter = 0x54C707Df83f03bc9cA64ED2CcF9C99B63FD854b7;
        u.v4Quoter = 0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227;
        u.mixedRouteQuoterV2 = 0x4745F77b56a0E2294426E3936dc4Fab68d9543Cd;
        u.permit2 = PERMIT2;
        u.poolManager = address(0); // read from factory.POOL_MANAGER()
    }

    function _uniswapMainnet() internal pure returns (UniswapAddrs memory u) {
        u.permissionsAdapterFactory = 0x7DA911490Ca4663E572eA9C8154f3CdEbCE16452;
        u.permissionedPositionManager = 0x63Bd7e5D4EcfAA74d82AE1dE98F476C935a81973;
        u.permissionedHooks = 0x499a724Ab630549f14C995EC41a8E04fA3fd28c0;
        u.universalRouter = 0x0542093271A31f6FC1DADB232bd59eeb27de780F;
        u.v4Quoter = 0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203;
        u.mixedRouteQuoterV2 = 0xE63C5F5005909E96b5aA9CE10744CCE70eC16CC3;
        u.permit2 = PERMIT2;
        u.poolManager = address(0);
    }

    function _uniswap() internal view returns (UniswapAddrs memory u) {
        if (block.chainid == 1) return _uniswapMainnet();
        // Sepolia (11155111) and Anvil forks of it (31337) share the same set.
        return _uniswapSepolia();
    }

    function _envOrAddr(string memory key, address dflt) internal view returns (address) {
        return vm.envOr(key, dflt);
    }

    function _deployerKey() internal view returns (uint256) {
        return vm.envUint("DEPLOYER_PRIVATE_KEY");
    }

    function _deploymentsPath(string memory section) internal view returns (string memory) {
        return string.concat("deployments/", vm.toString(block.chainid), ".", section, ".json");
    }
}
