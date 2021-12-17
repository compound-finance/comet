import { ForkSpec, Property, World, buildScenarioFn } from '../plugins/scenario';
import { ContractMap, getEthersContractsForDeployment } from '../plugins/spider';
import { Contract, Signer } from 'ethers';

async function getUntilEmpty<T>(emptyVal: T, fn: (index: number) => Promise<T>): Promise<T[]> {
  // Inner for TCO
  let index = 0;
  async function getUntilEmptyInner<T>(emptyVal: T, fn: (index: number) => Promise<T>, acc: T[]): Promise<T[]> {
    let curr = await fn(index++);
    if (curr === emptyVal) {
      return acc;
    } else {
      return getUntilEmptyInner(emptyVal, fn, acc.concat(curr))
    }
  }
  return await getUntilEmptyInner(emptyVal, fn, []);
}

export class CometContext {
  dog: string;
  contracts: ContractMap;

  constructor(dog: string, contracts: ContractMap) {
    this.dog = dog;
    this.contracts = contracts;
  }

  async players(): Promise<string[]> {
    return await getUntilEmpty("0x0000000000000000000000000000000000000000", async (index) => {
      return await this.contracts.raffle.players(index);
    });
  }
}

let contractDeployers: {[name: string]: ((world: World, contracts: ContractMap, signers: Signer[]) => Promise<Contract>)} = {
  token: async (world, contracts, signers) => {
    console.log("Deploying FaucetToken", 100000, "DAI", 18, "DAI");
    const FaucetToken = await world.hre.ethers.getContractFactory('FaucetToken');
    const token = await FaucetToken.deploy(100000, "DAI", 18, "DAI");
    return await token.deployed();
  },

  oracle: async (world, contracts, signers) => {
    console.log("Deploying Oracle", (<any>signers[1]).address);
    const Oracle = await world.hre.ethers.getContractFactory('MockedOracle');
    const oracle = await Oracle.connect(signers[1]).deploy();
    return await oracle.deployed();
  },

  raffle: async (world, contracts, signers) => {
    console.log("Deploying Raffle", '100000000000000000', contracts.token.address, contracts.oracle.address);
    const AsteroidRaffle = await world.hre.ethers.getContractFactory('AsteroidRaffle');
    const raffle = await AsteroidRaffle.deploy('100000000000000000', contracts.token.address, contracts.oracle.address);
    return await raffle.deployed();
  },
}

const getInitialContext = async (world: World, base: ForkSpec): Promise<CometContext> => {
  let contracts = await getEthersContractsForDeployment(world.hre, base.name);
  let signers = await world.hre.ethers.getSigners();

  // Deploy missing contracts
  for (let [name, deployer] of Object.entries(contractDeployers)) {
    if (!contracts[name]) {
      console.log("Deploying " + name);
      contracts[name] = await deployer(world, contracts, signers);
      console.log("Deployed " + name);
    }
  }

  return new CometContext("spot", contracts);
}

async function forkContext(c: CometContext): Promise<CometContext> {
  return c;
}

export const scenario = buildScenarioFn(getInitialContext, forkContext);
