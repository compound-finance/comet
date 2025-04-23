// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import { IBridge } from "./IBridge.sol";
import { IERC20 } from "../../vendor/interfaces/IERC20.sol";
import { SafeERC20 } from "../../vendor/token/ERC20/utils/SafeERC20.sol";

/// @title Delegator for Sonic Bridge
/// @notice This contract is used to delegate the claim process on the Sonic Cross-Chain Bridge.
contract Delegator {
    using SafeERC20 for IERC20;
    struct ClaimData {
        uint256 id;
        address token;
        uint256 amount;
        address l2Token;
        address to;
    }

    /// @notice Address of the timelock contract that this contract will receive messages from
    address public timelock;
    /// @notice Address of the bridge contract that this contract will send funds to
    address public bridge;

    /// @notice Mapping of claim id to claim data
    mapping(uint256 => ClaimData) public claims;

    /// @notice Initialize the contract with the timelock and bridge addresses
    /// @param _timelock Address of the timelock contract that this contract will receive messages from
    /// @param _bridge Address of the bridge contract that this contract will send funds to
    function initialize(address _timelock, address _bridge) external {
        require(timelock == address(0), "already initialized");
        timelock = _timelock;
        bridge = _bridge;
    }

    /// @notice Set the claim data for a given claim id
    /// @param id The claim id
    /// @param token The address of the token to be claimed
    /// @param amount The amount of the token to be claimed
    /// @param l2Token The address of the token on the L2 chain
    /// @param to The address to send the claimed tokens to
    /// @dev This function can only be called by the contract itself
    function setClaimData(uint256 id, address token, uint256 amount, address l2Token, address to) external {
        require(msg.sender == address(this), "only delegator");
        claims[id] = ClaimData(id, token, amount, l2Token, to);
    }

    /// @notice Execute a batch of calls to the specified targets with the given call data and values
    /// @param targets The addresses of the targets to call
    /// @param callDatas The call data to send to each target
    /// @param values The values to send with each call
    /// @dev This function can only be called by the timelock contract
    function call(address[] calldata targets, bytes[] calldata callDatas, uint256[] calldata values) external payable {
        require(msg.sender == timelock, "only timelock");
        require(targets.length == callDatas.length && targets.length == values.length, "targets and data length mismatch");
        for (uint i = 0; i < targets.length; i++) {
            (bool success, bytes memory returnData) = targets[i].call{value: values[i]}(callDatas[i]);
            if (!success) {
                // revert with the original error message from the call
                if (returnData.length > 0) {
                    // bubble up the error message from the call
                    assembly {
                        let returndata_size := mload(returnData)
                        revert(add(32, returnData), returndata_size)
                    }
                } else {
                    revert("Delegator: call failed");
                }
            }
        }
    }

    /// @notice Proceed with the claim process for a given claim id
    /// @param id The claim id
    /// @param proof The proof to be used for the claim
    /// @dev This function can be called by anyone
    function proceedClaim(uint256 id, bytes calldata proof) external {
        ClaimData memory claimData = claims[id];
        IBridge(bridge).claim(claimData.id, claimData.token, claimData.amount, proof);
        IERC20(claimData.l2Token).safeTransfer(claimData.to, claimData.amount);
    }
}
