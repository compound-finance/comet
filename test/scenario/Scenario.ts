import { ethers } from 'hardhat';
import { Greeter__factory, Greeter } from '../../build/types'

class Scenario {
    greeter: Greeter;

    constructor({greeterContract}) {
        this.greeter = greeterContract;
    }

    static async with({greeter}) {
        const greeterFactory = await ethers.getContractFactory('Greeter') as Greeter__factory;
        const greeterContract: Greeter = await greeterFactory.deploy(greeter.message);
        await greeterContract.deployed();

        return new Scenario({greeterContract})
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
}

export default Scenario;