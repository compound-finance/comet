// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../ITimelock.sol";

contract BaseBridgeReceiver {
    error AlreadyInitialized();
    error BadData();
    error Unauthorized();

    event Initialized(address indexed l2Timelock, address indexed mainnetTimelock);
    event NewL2Timelock(address indexed oldL2Timelock, address indexed newL2Timelock);
    event NewMainnetTimelock(address indexed oldMainnetTimelock, address indexed newMainnetTimelock);
    event ProcessMessage(address indexed messageSender, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint eta);

    address public initializer;
    address public mainnetTimelock;
    address public l2Timelock;

    constructor(address _initializer) {
        initializer = _initializer;
    }

    function initialize(address _mainnetTimelock, address _l2Timelock) external {
        if (initializer == address(0)) revert AlreadyInitialized();
        if (msg.sender != initializer) revert Unauthorized();
        mainnetTimelock = _mainnetTimelock;
        l2Timelock = _l2Timelock;
        initializer = address(0);
        emit Initialized(_mainnetTimelock, _l2Timelock);
    }

    function acceptL2TimelockAdmin() external {
        if (msg.sender != l2Timelock) revert Unauthorized();
        ITimelock(l2Timelock).acceptAdmin();
    }

    function setL2Timelock(address newTimelock) public {
        if (msg.sender != l2Timelock) revert Unauthorized();
        address oldL2Timelock = l2Timelock;
        l2Timelock = newTimelock;
        emit NewL2Timelock(oldL2Timelock, newTimelock);
    }

    function setMainnetTimelock(address newTimelock) public {
        if (msg.sender != l2Timelock) revert Unauthorized();
        address oldMainnetTimelock = mainnetTimelock;
        mainnetTimelock = newTimelock;
        emit NewMainnetTimelock(oldMainnetTimelock, newTimelock);
    }

    function processMessage(
        address messageSender,
        bytes calldata data
    ) internal {
        if (messageSender != mainnetTimelock) revert Unauthorized();

        address[] memory targets;
        uint256[] memory values;
        string[] memory signatures;
        bytes[] memory calldatas;

        (targets, values, signatures, calldatas) = abi.decode(
            data,
            (address[], uint256[], string[], bytes[])
        );

        if (values.length != targets.length) revert BadData();
        if (signatures.length != targets.length) revert BadData();
        if (calldatas.length != targets.length) revert BadData();

        uint delay = ITimelock(l2Timelock).delay();
        uint eta = block.timestamp + delay;

        for (uint8 i = 0; i < targets.length; ) {
            ITimelock(l2Timelock).queueTransaction(targets[i], values[i], signatures[i], calldatas[i], eta);
            unchecked { i++; }
        }

        emit ProcessMessage(messageSender, targets, values, signatures, calldatas, eta);
    }
}