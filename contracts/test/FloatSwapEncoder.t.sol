// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {FloatSwapEncoder} from "@float/libraries/FloatSwapEncoder.sol";

contract FloatSwapEncoderTest is Test {
    address internal usdc = makeAddr("usdc");
    address internal adapter = makeAddr("adapter");
    address internal hooks = makeAddr("hooks");
    address internal recipient = makeAddr("recipient");

    function _plan() internal view returns (FloatSwapEncoder.SwapPlan memory) {
        return FloatSwapEncoder.SwapPlan({
            poolKey: PoolKey({
                currency0: Currency.wrap(usdc < adapter ? usdc : adapter),
                currency1: Currency.wrap(usdc < adapter ? adapter : usdc),
                fee: 3000,
                tickSpacing: 60,
                hooks: IHooks(hooks)
            }),
            zeroForOne: true,
            amountIn: 6_000e6,
            amountOutMinimum: 5_900e6,
            inputCurrency: Currency.wrap(usdc),
            outputCurrency: Currency.wrap(adapter),
            recipient: recipient
        });
    }

    function test_encodesV4SwapCommand() public view {
        (bytes memory commands, bytes[] memory inputs) = FloatSwapEncoder.encode(_plan());
        assertEq(commands.length, 1);
        assertEq(uint8(commands[0]), 0x10); // Commands.V4_SWAP
        assertEq(inputs.length, 1);
    }

    function test_actionsSequenceAndParams() public view {
        (, bytes[] memory inputs) = FloatSwapEncoder.encode(_plan());
        (bytes memory actions, bytes[] memory params) = abi.decode(inputs[0], (bytes, bytes[]));

        assertEq(actions.length, 3);
        assertEq(uint8(actions[0]), uint8(Actions.SWAP_EXACT_IN_SINGLE));
        assertEq(uint8(actions[1]), uint8(Actions.SETTLE_ALL));
        assertEq(uint8(actions[2]), uint8(Actions.TAKE));
        assertEq(params.length, 3);

        IV4Router.ExactInputSingleParams memory sp = abi.decode(params[0], (IV4Router.ExactInputSingleParams));
        assertEq(sp.amountIn, 6_000e6);
        assertEq(sp.amountOutMinimum, 5_900e6);
        assertTrue(sp.zeroForOne);
        assertEq(sp.minHopPriceX36, 0);

        (Currency settleCurrency, uint256 maxAmount) = abi.decode(params[1], (Currency, uint256));
        assertEq(Currency.unwrap(settleCurrency), usdc);
        assertEq(maxAmount, 6_000e6);

        (Currency takeCurrency, address takeRecipient, uint256 takeAmount) =
            abi.decode(params[2], (Currency, address, uint256));
        assertEq(Currency.unwrap(takeCurrency), adapter);
        assertEq(takeRecipient, recipient);
        assertEq(takeAmount, 0); // OPEN_DELTA
    }
}
