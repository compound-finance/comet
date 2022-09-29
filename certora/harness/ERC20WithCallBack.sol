// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;
import '../munged/CometInterface.sol';

/**
 * @title Certora's dummy ERC20 implementation contract
 * @notice Dummy implementation of ERC20 protocol, including the basic functions included in a standard ERC20 interface
 * @author Certora
 */
contract ERC20WithCallBack  {




    uint256 supply;
    mapping (address => uint256) balances;
    mapping (address => mapping (address => uint256)) allowances;

    string public name;
    string public symbol;
    uint public decimals;


    /* symbolic variables for calling back comet */
    CometInterface comet;
    address assetArg;
    address srcArg;
    address toArg;
    uint256 amountArg;
    uint256 minAmountArg;
    uint256 baseAmoutArg;
    address recipientArg;
    bool random;

    function callBack() internal {
        // add callbacks to pool - check one function at a time to have less timeouts 
        if (random) 
            //comet.withdrawFrom(srcArg, toArg, assetArg, amountArg)
            // comet.buyCollateral(assetArg, minAmountArg, baseAmoutArg, recipientArg);
            // comet.supply(assetArg,amountArg);
            //comet.transferFrom(srcArg, toArg, amountArg); 
            comet.transferAssetFrom(srcArg, toArg, assetArg, amountArg);
    }
    /**
     * @dev Returns the amount of tokens in existence.
     */
    function totalSupply() external view returns (uint256) {
        return supply;
    }

    /**
     * @dev Returns the amount of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    /**
     * @dev Moves `amount` tokens from the caller's account to `recipient`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     */
    function transfer(address recipient, uint256 amount) external returns (bool) {
        balances[msg.sender] = balances[msg.sender]- amount;
        balances[recipient] = balances[recipient] + amount;
        callBack();
        return true;
    }

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256) {
        return allowances[owner][spender];
    }

    /**
     * @dev Sets `amount` as the allowance of `spender` over the caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 amount) external returns (bool) {
        allowances[msg.sender][spender] = amount;
        return true;
    }

    /**
     * @dev Moves `amount` tokens from `sender` to `recipient` using the
     * allowance mechanism. `amount` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     */
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool) {
        balances[sender] = balances[sender]- amount;
        balances[recipient] = balances[recipient] + amount;
        allowances[sender][msg.sender] = allowances[sender][msg.sender] - amount;
        callBack();
        return true;
    }
}