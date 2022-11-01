// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./BaseBulker.sol";
import "../IWstETH.sol";

contract MainnetBulker is BaseBulker {
    address public immutable steth;
    address public immutable wsteth;

    bytes32 public constant ACTION_SUPPLY_STETH = "ACTION_SUPPLY_STETH";
    bytes32 public constant ACTION_WITHDRAW_STETH = "ACTION_WITHDRAW_STETH";

    constructor(
        address admin_,
        address payable weth_,
        address wsteth_
    ) BaseBulker(admin_, weth_) {
        wsteth = wsteth_;
        steth = IWstETH(wsteth_).stETH();
    }

    function handleAction(bytes32 action, bytes calldata data) override internal {
        if (action == ACTION_SUPPLY_STETH) {
            (address comet, address to, uint stETHAmount) = abi.decode(data, (address, address, uint));
            supplyStEthTo(comet, to, stETHAmount);
        } else if (action == ACTION_WITHDRAW_STETH) {
            (address comet, address to, uint wstETHAmount) = abi.decode(data, (address, address, uint));
            withdrawStEthTo(comet, to, wstETHAmount);
        } else {
            revert UnhandledAction();
        }
    }

    /**
     * @notice Wraps stETH with wstETH and supplies to a user in Comet
     */
    function supplyStEthTo(address comet, address to, uint stETHAmount) internal {
        // transfer in from stETH
        ERC20(steth).transferFrom(msg.sender, address(this), stETHAmount);
        // approve stETHAmount to the wstETH contract
        ERC20(steth).approve(wsteth, stETHAmount);
        // wrap stETHAmount
        uint wstETHAmount = IWstETH(wsteth).wrap(stETHAmount);
        // approve Comet for the wstETH amount
        ERC20(wsteth).approve(comet, wstETHAmount);
        // supply
        CometInterface(comet).supplyFrom(address(this), to, wsteth, wstETHAmount);
    }

    /**
     * @notice Withdraws wstETH from Comet to a user after unwrapping it to stETH
     */
    function withdrawStEthTo(address comet, address to, uint wstETHAmount) internal {
        CometInterface(comet).withdrawFrom(msg.sender, address(this), wsteth, wstETHAmount);
        uint stETHAmount = IWstETH(wsteth).unwrap(wstETHAmount);
        ERC20(steth).transfer(to, stETHAmount);
    }
}