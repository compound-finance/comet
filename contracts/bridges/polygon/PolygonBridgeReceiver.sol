// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../../ITimelock.sol";
import "../vendor/fx-portal/contracts/FxChild.sol";

contract PolygonBridgeReceiver is IFxMessageProcessor {
    error Unauthorized();
    error AlreadyInitialized();
    error BadData();
    error InvalidChild();

    event NewMainnetTimelock(address indexed oldMainnetTimelock, address indexed newMainnetTimelock);
    event NewL2Timelock(address indexed oldL2Timelock, address indexed newL2Timelock);
    event NewAdmin(address indexed oldAdmin, address indexed admin);
    event ProcessMessageFromRoot(address indexed messageSender, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint eta);
    event NewFxChild(address indexed oldFxChild, address indexed newFxChild);

    address public mainnetTimelock;
    address public l2Timelock;
    address public admin;
    address public fxChild;

    constructor(address _admin) {
        admin = _admin;
    }

    function initialize(address _mainnetTimelock, address _l2Timelock, address _fxChild) external {
        if (msg.sender != admin) revert Unauthorized();
        if (mainnetTimelock != address(0)) revert AlreadyInitialized();
        mainnetTimelock = _mainnetTimelock;
        l2Timelock = _l2Timelock;
        fxChild = _fxChild;
    }

    function acceptL2TimelockAdmin() external {
        if (msg.sender != l2Timelock) revert Unauthorized();
        ITimelock(l2Timelock).acceptAdmin();
    }

    function changeAdmin(address newAdmin) public {
        if (msg.sender != admin) revert Unauthorized();
        address oldAdmin = admin;
        admin = newAdmin;
        emit NewAdmin(oldAdmin, newAdmin);
    }

    function changeL2Timelock(address newTimelock) public {
        if (msg.sender != l2Timelock) revert Unauthorized();
        address oldL2Timelock = l2Timelock;
        l2Timelock = newTimelock;
        emit NewL2Timelock(oldL2Timelock, newTimelock);
    }

    function changeMainnetTimelock(address newTimelock) public {
        if (msg.sender != l2Timelock) revert Unauthorized();
        address oldMainnetTimelock = mainnetTimelock;
        mainnetTimelock = newTimelock;
        emit NewMainnetTimelock(oldMainnetTimelock, newTimelock);
    }

    function changeFxChild(address newFxChild) public {
        if (msg.sender != l2Timelock) revert Unauthorized();
        address oldFxChild = fxChild;
        fxChild = newFxChild;
        emit NewFxChild(oldFxChild, newFxChild);
    }

    // original msg.sender that called fxRoot (l1 timelock)
    function processMessageFromRoot(
        uint256 stateId,
        address messageSender,
        bytes calldata data
    ) public override {
        if (msg.sender != fxChild) revert InvalidChild();
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

        emit ProcessMessageFromRoot(messageSender, targets, values, signatures, calldatas, eta);
    }
}