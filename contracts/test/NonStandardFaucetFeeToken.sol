// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "../IERC20NonStandard.sol";

/**
 * @title Non-standard ERC20 token
 * @dev Implementation of the basic standard token.
 *  See https://github.com/ethereum/EIPs/issues/20
 * @dev With USDT fee token mechanism
 * @dev Note: `transfer` and `transferFrom` do not return a boolean
 */
contract NonStandardFeeToken is IERC20NonStandard {
    string public name;
    string public symbol;
    uint8 public decimals;
    address public owner;
    uint256 public totalSupply;
    mapping(address => mapping (address => uint256)) public allowance;
    mapping(address => uint256) public balanceOf;
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Params(uint feeBasisPoints, uint maxFee);

    // additional variables for use if transaction fees ever became necessary
    uint public basisPointsRate = 0;
    uint public maximumFee = 0;

    constructor(uint256 _initialAmount, string memory _tokenName, uint8 _decimalUnits, string memory _tokenSymbol) {
        totalSupply = _initialAmount;
        balanceOf[msg.sender] = _initialAmount;
        name = _tokenName;
        symbol = _tokenSymbol;
        decimals = _decimalUnits;
    }

    function transfer(address dst, uint256 amount) external virtual {
        require(amount <= balanceOf[msg.sender], "ERC20: transfer amount exceeds balance");
        uint256 fee = amount * basisPointsRate / 10000;
        uint256 sendAmount = amount - fee;
        if (fee > maximumFee) {
            fee = maximumFee;
        }

        // For testing purpose, just forward fee to contract itself
        if (fee > 0) {
            balanceOf[address(this)] = balanceOf[address(this)] + fee;
        }

        balanceOf[msg.sender] = balanceOf[msg.sender] - amount;
        balanceOf[dst] = balanceOf[dst] + sendAmount;
        emit Transfer(msg.sender, dst, sendAmount);
    }

    function transferFrom(address src, address dst, uint256 amount) external virtual {
        require(amount <= allowance[src][msg.sender], "ERC20: transfer amount exceeds allowance");
        require(amount <= balanceOf[src], "ERC20: transfer amount exceeds balance");
        uint256 fee = amount * basisPointsRate / 10000;
        uint256 sendAmount = amount - fee;
        if (fee > maximumFee) {
            fee = maximumFee;
        }

        // For testing purpose, just forward fee to contract itself
        if (fee > 0) {
            balanceOf[address(this)] = balanceOf[address(this)] + fee;
        }

        allowance[src][msg.sender] = allowance[src][msg.sender] - amount;
        balanceOf[src] = balanceOf[src] - amount;
        balanceOf[dst] = balanceOf[dst] + sendAmount;
        emit Transfer(src, dst, sendAmount);
    }

    function approve(address _spender, uint256 amount) external {
        allowance[msg.sender][_spender] = amount;
        emit Approval(msg.sender, _spender, amount);
    }

    // For testing, just don't limit access on setting fees
    function setParams(uint256 newBasisPoints, uint256 newMaxFee) public {
        basisPointsRate = newBasisPoints;
        maximumFee = newMaxFee * (10**decimals);

        emit Params(basisPointsRate, maximumFee);
    }
}

/**
 * @title The Compound Faucet Test Token
 * @author Compound
 * @notice A simple test token that lets anyone get more of it.
 */
contract NonStandardFaucetFeeToken is NonStandardFeeToken {
    constructor(uint256 _initialAmount, string memory _tokenName, uint8 _decimalUnits, string memory _tokenSymbol)
        NonStandardFeeToken(_initialAmount, _tokenName, _decimalUnits, _tokenSymbol) {
    }

    function allocateTo(address _owner, uint256 value) public {
        balanceOf[_owner] += value;
        totalSupply += value;
        emit Transfer(address(this), _owner, value);
    }
}
