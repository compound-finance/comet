// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

contract Dog {
    bool public initialized;
    string public name;
    Dog public father;
    Dog[] public pups;

    struct Puppers {
        uint index;
        Dog pup;
    }

    function initializeDog(string memory name_, Dog father_, Dog[] memory pups_) public {
        require(!initialized, "already initialized");
        initialized = true;
        name = name_;
        father = father_;
        for (uint i = 0; i < pups_.length; i++) {
            pups.push(pups_[i]);
        }
    }

    constructor(string memory name_, Dog father_, Dog[] memory pups_) {
        initializeDog(name_, father_, pups_);
    }

    function addPup(Dog pup) public {
        pups.push(pup);
    }

    function puppers() public returns (Puppers[] memory) {
        Puppers[] memory puppers = new Puppers[](pups.length);
        for (uint i = 0; i < pups.length; i++) {
            puppers[i] = Puppers({
                index: i,
                pup: pups[i]
            });
        }
        return puppers;
    }
}
