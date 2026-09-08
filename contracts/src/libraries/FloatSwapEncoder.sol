// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {ActionConstants} from "@uniswap/v4-periphery/src/libraries/ActionConstants.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";

/// @title FloatSwapEncoder
/// @notice Builds the `execute(commands, inputs, deadline)` calldata for a single
///         exact-input swap on Float's Uniswap v4 Permissioned Pool.
///
/// @dev The action sequence is SWAP_EXACT_IN_SINGLE → SETTLE_ALL → TAKE:
///      - SWAP settles the exact input and enforces `amountOutMinimum`.
///      - SETTLE_ALL pays the input currency from the router caller (the executor,
///        via Permit2).
///      - TAKE sends the full output credit straight to `recipient` (the business
///        smart account). For the permissioned leg, PoolManager.take transfers the
///        adapter token to `recipient`, whose transfer hook atomically unwraps it
///        to the underlying (FloatUSTB) — so the executor never custodies output.
library FloatSwapEncoder {
    /// @dev Universal Router command id for a v4 swap (Commands.V4_SWAP).
    bytes1 internal constant V4_SWAP = 0x10;

    struct SwapPlan {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        Currency inputCurrency;
        Currency outputCurrency;
        address recipient;
    }

    /// @return commands single-byte V4_SWAP command.
    /// @return inputs   one element: `abi.encode(actions, params)`.
    function encode(SwapPlan memory plan) internal pure returns (bytes memory commands, bytes[] memory inputs) {
        bytes memory actions =
            abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE));

        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: plan.poolKey,
                zeroForOne: plan.zeroForOne,
                amountIn: plan.amountIn,
                amountOutMinimum: plan.amountOutMinimum,
                minHopPriceX36: 0,
                hookData: bytes("")
            })
        );
        // SETTLE_ALL: (currency, maxAmount)
        params[1] = abi.encode(plan.inputCurrency, uint256(plan.amountIn));
        // TAKE: (currency, recipient, amount) — OPEN_DELTA takes the full credit.
        params[2] = abi.encode(plan.outputCurrency, plan.recipient, uint256(ActionConstants.OPEN_DELTA));

        commands = abi.encodePacked(V4_SWAP);
        inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
    }
}
