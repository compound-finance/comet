// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.15;

interface IL1StandardBridge {
    event ERC20BridgeFinalized(
        address indexed localToken,
        address indexed remoteToken,
        address indexed from,
        address to,
        uint256 amount,
        bytes extraData
    );
    event ERC20BridgeInitiated(
        address indexed localToken,
        address indexed remoteToken,
        address indexed from,
        address to,
        uint256 amount,
        bytes extraData
    );
    event ERC20DepositInitiated(
        address indexed l1Token,
        address indexed l2Token,
        address indexed from,
        address to,
        uint256 amount,
        bytes extraData
    );
    event ERC20WithdrawalFinalized(
        address indexed l1Token,
        address indexed l2Token,
        address indexed from,
        address to,
        uint256 amount,
        bytes extraData
    );
    event ETHBridgeFinalized(
        address indexed from,
        address indexed to,
        uint256 amount,
        bytes extraData
    );
    event ETHBridgeInitiated(
        address indexed from,
        address indexed to,
        uint256 amount,
        bytes extraData
    );
    event ETHDepositInitiated(
        address indexed from,
        address indexed to,
        uint256 amount,
        bytes extraData
    );
    event ETHWithdrawalFinalized(
        address indexed from,
        address indexed to,
        uint256 amount,
        bytes extraData
    );

    function MESSENGER() external view returns (address);

    function OTHER_BRIDGE() external view returns (address);

    function bridgeERC20(
        address _localToken,
        address _remoteToken,
        uint256 _amount,
        uint32 _minGasLimit,
        bytes memory _extraData
    ) external;

    function bridgeERC20To(
        address _localToken,
        address _remoteToken,
        address _to,
        uint256 _amount,
        uint32 _minGasLimit,
        bytes memory _extraData
    ) external;

    function bridgeETH(uint32 _minGasLimit, bytes memory _extraData)
        external
        payable;

    function bridgeETHTo(
        address _to,
        uint32 _minGasLimit,
        bytes memory _extraData
    ) external payable;

    function depositERC20(
        address _l1Token,
        address _l2Token,
        uint256 _amount,
        uint32 _minGasLimit,
        bytes memory _extraData
    ) external;

    function depositERC20To(
        address _l1Token,
        address _l2Token,
        address _to,
        uint256 _amount,
        uint32 _minGasLimit,
        bytes memory _extraData
    ) external;

    function depositETH(uint32 _minGasLimit, bytes memory _extraData)
        external
        payable;

    function depositETHTo(
        address _to,
        uint32 _minGasLimit,
        bytes memory _extraData
    ) external payable;

    function deposits(address, address) external view returns (uint256);

    function finalizeBridgeERC20(
        address _localToken,
        address _remoteToken,
        address _from,
        address _to,
        uint256 _amount,
        bytes memory _extraData
    ) external;

    function finalizeBridgeETH(
        address _from,
        address _to,
        uint256 _amount,
        bytes memory _extraData
    ) external payable;

    function finalizeERC20Withdrawal(
        address _l1Token,
        address _l2Token,
        address _from,
        address _to,
        uint256 _amount,
        bytes memory _extraData
    ) external;

    function finalizeETHWithdrawal(
        address _from,
        address _to,
        uint256 _amount,
        bytes memory _extraData
    ) external payable;

    function l2TokenBridge() external view returns (address);

    function messenger() external view returns (address);

    function version() external view returns (string memory);

    receive() external payable;
}
