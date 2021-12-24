import { Contract, Signer } from 'ethers'
import { ForkSpec, Property, World, buildScenarioFn } from '../plugins/scenario'
import { ContractMap, DeploymentManager } from '../plugins/deployment_manager/DeploymentManager'
import { RemoteTokenConstraint } from './constraints/RemoteTokenConstraint'
import RaffleMinEntriesConstraint from "./constraints/RaffleMinEntriesConstraint"
import RaffleStateConstraint from "./constraints/RaffleStateConstraint"


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

export class CometActor {
  signer: Signer;
  raffleContract: Contract;
  tokenContract: Contract;

  constructor(signer, raffleContract, tokenContract) {
    this.signer = signer;
    this.raffleContract = raffleContract;
    this.tokenContract = tokenContract;
  }

  async getAddress(): Promise<string> {
    return this.signer.getAddress();
  }

  async enterWithEth(ticketPrice: number) {
    (await this.raffleContract.connect(this.signer).enterWithEth({ value: ticketPrice })).wait();
  }

  async enterWithToken(ticketPrice: number) {
    (await this.tokenContract.allocateTo(this.signer.getAddress(), ticketPrice)).wait();
    (await this.tokenContract.connect(this.signer).approve(this.raffleContract.address, ticketPrice)).wait();
    (await this.raffleContract.connect(this.signer).enterWithToken()).wait();
  }

  async determineWinner() {
    (await this.raffleContract.connect(this.signer).determineWinner()).wait();
  }

  async restartRaffle(ticketPrice: number) {
    (await this.raffleContract.connect(this.signer).restartRaffle(ticketPrice)).wait();
  }
}

export class CometAsset {}

export class CometContext {
  dog: string;
  deploymentManager: DeploymentManager;
  actors: { [name: string]: CometActor };
  assets: { [name: string]: CometAsset }; // XXX
  remoteToken: Contract | undefined

  constructor(dog: string, deploymentManager: DeploymentManager, actors: { [name: string]: CometActor }) {
    this.dog = dog;
    this.deploymentManager = deploymentManager;
    this.actors = actors;
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
      const raffle = await AsteroidRaffle.deploy(contracts.token.address, contracts.oracle.address);
      const contract = await raffle.deployed();
      const tx = await raffle.initialize('100000000000000000', 3 * 60);
      await tx.wait();
      return contract;
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

  const [localAdminSigner, albertSigner, bettySigner, charlesSigner] = signers;
  let adminSigner;

  if (isDevelopment) {
    adminSigner = localAdminSigner;
  } else {
    const governorAddress = await deploymentManager.contracts.raffle.governor();
    adminSigner = await world.impersonateAddress(governorAddress);
  }

  const actors = {
    admin: new CometActor(adminSigner, deploymentManager.contracts.raffle, deploymentManager.contracts.token),
    albert: new CometActor(albertSigner, deploymentManager.contracts.raffle, deploymentManager.contracts.token),
    betty: new CometActor(bettySigner, deploymentManager.contracts.raffle, deploymentManager.contracts.token),
    charles: new CometActor(charlesSigner, deploymentManager.contracts.raffle, deploymentManager.contracts.token),
  };

  return new CometContext("spot", deploymentManager, actors);
}

async function forkContext(c: CometContext): Promise<CometContext> {
  return c;
}

export const constraints = [
  new RemoteTokenConstraint,
  new RaffleMinEntriesConstraint,
  new RaffleStateConstraint,
];

export const scenario = buildScenarioFn<CometContext>(getInitialContext, forkContext, constraints);