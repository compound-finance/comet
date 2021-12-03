pragma solidity ^0.8.0;

contract Configurator {
    uint public targetReserves;
    uint public borrowMin;

    constructor(uint targetReserves_, uint borrowMin_) {
       targetReserves = targetReserves_;
       borrowMin = borrowMin_;
    }

    function setTargetReserves(uint targetReserves_) public {
        targetReserves = targetReserves_;
    }

    function setBorrowMin(uint borrowMin_) public {
        borrowMin = borrowMin_;
    }
}