import { ForkSpec, Property, World, buildScenarioFn } from '../plugins/scenario'
import { ContractMap, getEthersContractsForDeployment } from '../plugins/spider'
import { BalanceConstraint } from './Constraints'
import { Contract, Signer } from 'ethers'

async function getUntilEmpty<T>(emptyVal: T, fn: (index: number) => Promise<T>): Promise<T[]> {
  // Inner for TCO
  let index = 0;
  async function getUntilEmptyInner<T>(emptyVal: T, fn: (index: number) => Promise<T>, acc: T[]): Promise<T[]> {
    let curr;
    try {
      curr = await fn(index++);
    } catch (e) {
      if (e.message.includes("Transaction reverted without a reason string")) {
        return acc;
      } else {
        throw e;
      }
    }

    if (curr === emptyVal) {
      return acc;
    } else {
      return getUntilEmptyInner(emptyVal, fn, acc.concat(curr))
    }
  }
  return await getUntilEmptyInner(emptyVal, fn, []);
}

export class CometActor {}
export class CometAsset {}

export class CometContext {
  dog: string;
  contracts: ContractMap;
  actors: { [name: string]: CometActor }; // XXX
  assets: { [name: string]: CometAsset }; // XXX

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

let contractDeployers: {[name: string]: { contract: string, deployer: ((world: World, contracts: ContractMap, signers: Signer[]) => Promise<Contract>) }} = {
  token: {
    contract: "DAIFaucetToken", // TODO: This should be handled by pointers.json
    deployer: async (world, contracts, signers) => {
      const FaucetToken = await world.hre.ethers.getContractFactory('FaucetToken');
      const token = await FaucetToken.deploy(100000, "DAI", 18, "DAI");
      return await token.deployed();
    },
  },

  oracle: {
    contract: "AsteroidRaffleMockedOracle", // TODO: This should be handled by pointers.json
    deployer: async (world, contracts, signers) => {
      const Oracle = await world.hre.ethers.getContractFactory('MockedOracle');
      const oracle = await Oracle.connect(signers[1]).deploy();
      return await oracle.deployed();
    },
  },

  raffle: {
    contract: "AsteroidRaffle", // TODO: This should be handled by pointers.json
    deployer: async (world, contracts, signers) => {
      const AsteroidRaffle = await world.hre.ethers.getContractFactory('AsteroidRaffle');
      const raffle = await AsteroidRaffle.deploy('100000000000000000', contracts.token.address, contracts.oracle.address);
      return await raffle.deployed();
    },
  },
}

const getInitialContext = async (world: World, base: ForkSpec): Promise<CometContext> => {
  const isDevelopment = !base.url;

  if (isDevelopment) {
    await world.hre.run("compile");
  }

  let contracts = isDevelopment ? {} : await getEthersContractsForDeployment(world.hre, base.name);
  let signers = await world.hre.ethers.getSigners();

  // Deploy missing contracts
  for (let [name, {contract, deployer}] of Object.entries(contractDeployers)) {
    let contractInst = contracts[contract];

    if (contractInst) {
      contracts[name] = contractInst;
    } else {
      console.log("Deploying " + name);
      contracts[name] = await deployer(world, contracts, signers);
    }
  }

  return new CometContext("spot", contracts);
}

async function forkContext(c: CometContext): Promise<CometContext> {
  return c;
}

export const constraints = [
  new BalanceConstraint,
];

export const scenario = buildScenarioFn(getInitialContext, forkContext, constraints);
