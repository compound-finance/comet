// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../../ITimelock.sol";
import "./FxBaseChildTunnel.sol";

contract PolygonBridgeReceiver is IFxMessageProcessor {
    error Unauthorized();

    event NewMainnetTimelock(address indexed newMainnetTimelock);
    event NewL2Timelock(address indexed newL2Timelock);

    address public mainnetTimelock;
    address public l2Timelock; // also the admin

    constructor(
        address _mainnetTimelock,
        address _l2Timelock
    ) {
        mainnetTimelock = _mainnetTimelock;
        l2Timelock = _l2Timelock;
    }

    function changeL2Timelock(address newTimelock) public {
        if (msg.sender != l2Timelock) revert Unauthorized();
        l2Timelock = newTimelock;
        emit NewL2Timelock(l2Timelock);
    }

    function changeMainnetTimelock(address newTimelock) public {
        if (msg.sender != l2Timelock) revert Unauthorized();
        mainnetTimelock = newTimelock;
        emit NewMainnetTimelock(mainnetTimelock);
    }

    function processMessageFromRoot(
        uint256 stateId,
        address messageSender, // original msg.sender that called fxRoot (l1 timelock)
        bytes calldata data
    ) public override {
        if (messageSender != mainnetTimelock) revert Unauthorized();

        address[] memory targets;
        uint256[] memory values;
        string[] memory signatures;
        bytes[] memory calldatas;

        (targets, values, signatures, calldatas) = abi.decode(
            data,
            (address[], uint256[], string[], bytes[])
        );

        uint delay = ITimelock(l2Timelock).delay();
        uint eta = block.timestamp + delay + 1; // buffer necessary?

        for (uint8 i = 0; i < targets.length; ) {
            ITimelock(l2Timelock).queueTransaction(targets[i], values[i], signatures[i], calldatas[i], eta);
            unchecked { i++; }
        }
    }
}