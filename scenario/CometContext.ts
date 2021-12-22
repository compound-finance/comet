import { ForkSpec, Property, World, buildScenarioFn } from '../plugins/scenario'
import { ContractMap, DeploymentManager } from '../plugins/deployment_manager/DeploymentManager'
import { BalanceConstraint } from './Constraints'
import { RemoteTokenConstraint } from './constraints/RemoteTokenConstraint'
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
  deploymentManager: DeploymentManager;
  actors: { [name: string]: CometActor }; // XXX
  assets: { [name: string]: CometAsset }; // XXX
  remoteToken: Contract | undefined

  constructor(dog: string, deploymentManager: DeploymentManager) {
    this.dog = dog;
    this.deploymentManager = deploymentManager;
  }

  contracts(): ContractMap {
    return this.deploymentManager.contracts;
  }

  async players(): Promise<string[]> {
    return await getUntilEmpty("0x0000000000000000000000000000000000000000", async (index) => {
      return await this.contracts().raffle.players(index);
    });
  }
}

let contractDeployers: {[name: string]: { contract: string, deployer: ((world: World, contracts: ContractMap, signers: Signer[]) => Promise<Contract>) }} = {
  token: {
    contract: "FaucetToken", // TODO: This should be handled by pointers.json
    deployer: async (world, contracts, signers) => {
      const FaucetToken = await world.hre.ethers.getContractFactory('FaucetToken');
      const token = await FaucetToken.deploy(100000, "DAI", 18, "DAI");
      return await token.deployed();
    },
  },

  oracle: {
    contract: "MockedOracle", // TODO: This should be handled by pointers.json
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
  let deploymentManager = new DeploymentManager(base.name, world.hre);

  if (isDevelopment) {
    await world.hre.run("compile"); // I mean, should we compile anyway?
  } else {
    await deploymentManager.spider()
  }

  let signers = await world.hre.ethers.getSigners();

  // Deploy missing contracts
  for (let [name, {contract, deployer}] of Object.entries(contractDeployers)) {
    let contractInst = deploymentManager.contracts[contract];

    if (contractInst) {
      deploymentManager.contracts[name] = contractInst;
    } else {
      console.log("Deploying " + name);
      deploymentManager.contracts[name] = await deployer(world, deploymentManager.contracts, signers);
    }
  }

  return new CometContext("spot", deploymentManager);
}

async function forkContext(c: CometContext): Promise<CometContext> {
  return c;
}

export const constraints = [
  new RemoteTokenConstraint,
];

export const scenario = buildScenarioFn<CometContext>(getInitialContext, forkContext, constraints);
