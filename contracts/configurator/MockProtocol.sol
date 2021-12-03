// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

contract MockProtocol {
    uint public immutable targetReserves;
    uint public immutable borrowMin;

    event Values(uint targetReserves, uint borrowMin);

    constructor(uint targetReserves_, uint borrowMin_) {
        targetReserves = targetReserves_;
        borrowMin = borrowMin_;
    }

    function getData() public returns (uint, uint) {
        emit Values(targetReserves, borrowMin);
        return (targetReserves, borrowMin);
    }

}