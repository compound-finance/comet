pragma solidity ^0.8.11;

// import "./DummyERC20Impl.sol";

contract DummyERC20Impl  {

    uint256 supply;
    mapping (address => uint256) balances;
    mapping (address => mapping (address => uint256)) allowances;

    string public name;
    string public symbol;
    uint public decimals;

    function totalSupply() external view returns (uint256) {
        return supply;
    }
    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }
    function transfer(address recipient, uint256 amount) external returns (bool) {
        balances[msg.sender] = balances[msg.sender]- amount;
        balances[recipient] = balances[recipient] + amount;
        return true;
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowances[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool) {
        balances[sender] = balances[sender]- amount;
        balances[recipient] = balances[recipient] + amount;
        allowances[sender][msg.sender] = allowances[sender][msg.sender] - amount;
        return true;
    }
}