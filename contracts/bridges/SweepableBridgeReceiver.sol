// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../IERC20NonStandard.sol";
import "./BaseBridgeReceiver.sol";

contract SweepableBridgeReceiver is BaseBridgeReceiver {
    error FailedToSendNativeToken();
    error TransferOutFailed();

    /**
     * @notice A public function to sweep accidental ERC-20 transfers to this contract
     * @dev Note: Make sure to check that the asset being swept out is not malicious
     * @param recipient The address that will receive the swept funds
     * @param asset The address of the ERC-20 token to sweep
     */
    function sweepToken(address recipient, address asset) external {
        if (msg.sender != localTimelock) revert Unauthorized();

        uint256 balance = IERC20NonStandard(asset).balanceOf(address(this));
        doTransferOut(asset, recipient, balance);
    }

    /**
     * @notice A public function to sweep accidental native token transfers to this contract
     * @param recipient The address that will receive the swept funds
     */
    function sweepNativeToken(address recipient) external {
        if (msg.sender != localTimelock) revert Unauthorized();

        uint256 balance = address(this).balance;
        (bool success, ) = recipient.call{ value: balance }("");
        if (!success) revert FailedToSendNativeToken();
    }

    /**
     * @notice Similar to ERC-20 transfer, except it properly handles `transfer` from non-standard ERC-20 tokens
     * @param asset The ERC-20 token to transfer out
     * @param to The recipient of the token transfer
     * @param amount The amount of the token to transfer
     * @dev Note: This wrapper safely handles non-standard ERC-20 tokens that do not return a value. See here: https://medium.com/coinmonks/missing-return-value-bug-at-least-130-tokens-affected-d67bf08521ca
     */
    function doTransferOut(address asset, address to, uint amount) internal {
        IERC20NonStandard(asset).transfer(to, amount);

        bool success;
        assembly {
            switch returndatasize()
                case 0 {                      // This is a non-standard ERC-20
                    success := not(0)         // set success to true
                }
                case 32 {                     // This is a compliant ERC-20
                    returndatacopy(0, 0, 32)
                    success := mload(0)       // Set `success = returndata` of override external call
                }
                default {                     // This is an excessively non-compliant ERC-20, revert.
                    revert(0, 0)
                }
        }
        if (!success) revert TransferOutFailed();
    }
}