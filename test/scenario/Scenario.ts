import { Signer } from '@ethersproject/abstract-signer';
import { ethers } from 'hardhat';
import { Greeter__factory, Greeter } from '../../build/types'

class Scenario {
    greeter: Greeter;
    owner: Signer;

    constructor({greeterContract, owner}) {
        this.greeter = greeterContract;
        this.owner = owner;
    }

    static async with({greeter}) {
        const greeterFactory = await ethers.getContractFactory('Greeter') as Greeter__factory;
        const greeterContract: Greeter = await greeterFactory.deploy(greeter.message);
        await greeterContract.deployed();

        const [owner] = await ethers.getSigners();

        return new Scenario({
            greeterContract,
            owner
        })
    }

    async increaseTime(seconds) {
        /*
        // wrapper around `evm_increaseTime`
        // https://hardhat.org/hardhat-network/reference/#evm-increasetime

        await hre.network.provider.request({
            method: "evm_increaseTime",
            params: [seconds],
        });
        */
    }

    async mineBlock() {
        /*
        wrapper around `evm_mine`
        https://hardhat.org/hardhat-network/reference/#evm-mine

        await hre.network.provider.request({
            method: "evm_mine",
            params: [],
        });
        */
    }
}

export default Scenario;