// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./IBridge.sol";
import "../../IERC20.sol";

contract Delegator {    
    struct ClaimData {
        uint256 id;
        address token;
        uint256 amount;
        address l2Token;
        address to;
    }

    address public timelock;
    address public bridge;

    /// @notice Mapping of claim id to claim data
    mapping(uint256 => ClaimData) public claims;

    function initialize(address _timelock, address _bridge) public {
        require(timelock == address(0), "already initialized");
        timelock = _timelock;
        bridge = _bridge;
    }

    function setClaimData(uint256 id, address token, uint256 amount, address l2Token, address to) public {
        require(msg.sender == address(this), "only delegator");
        claims[id] = ClaimData(id, token, amount, l2Token, to);
    }

    function call(address[] calldata targets, bytes[] calldata callDatas, uint256[] calldata values) public payable {
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

    function proceedClaim(uint256 id, bytes calldata proof) public {
        ClaimData memory claimData = claims[id];
        IBridge(bridge).claim(claimData.id, claimData.token, claimData.amount, proof);
        IERC20(claimData.l2Token).transfer(claimData.to, claimData.amount);     
    }
}
