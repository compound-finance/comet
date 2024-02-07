// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

/**
 * @title IERC20NonStandard
 * @dev Version of ERC20 with no return values for `approve`, `transfer`, and `transferFrom`
 *  See https://medium.com/coinmonks/missing-return-value-bug-at-least-130-tokens-affected-d67bf08521ca
 */
interface IERC20NonStandard {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);

    /**
     * @notice Approve `spender` to transfer up to `amount` from `src`
     * @dev This will overwrite the approval amount for `spender`
     *  and is subject to issues noted [here](https://eips.ethereum.org/EIPS/eip-20#approve)
     * @param spender The address of the account which may transfer tokens
     * @param amount The number of tokens that are approved (-1 means infinite)
     */
    function approve(address spender, uint256 amount) external;

    /**
     * @notice Transfer `value` tokens from `msg.sender` to `to`
     * @param to The address of the destination account
     * @param value The number of tokens to transfer
     */
    function transfer(address to, uint256 value) external;

    /**
     * @notice Transfer `value` tokens from `from` to `to`
     * @param from The address of the source account
     * @param to The address of the destination account
     * @param value The number of tokens to transfer
     */
    function transferFrom(address from, address to, uint256 value) external;

    /**
     * @notice Gets the balance of the specified address
     * @param account The address from which the balance will be retrieved
     */
    function balanceOf(address account) external view returns (uint256);
}
