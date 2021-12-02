pragma solidity ^0.8.0;

contract Config {
    uint immutable public targetReserves;
    uint immutable public borrowMin;

    constructor(uint targetReserves_, uint borrowMin_) {
       targetReserves = targetReserves_;
       borrowMin = borrowMin_;
    }
}