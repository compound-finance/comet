import { BigNumber } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { CometInterface } from '../../build/types';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';

type Config = {
  hre: HardhatRuntimeEnvironment
};

type Borrower = {
  address: string;
  liquidationMargin: BigNumber | undefined;
  lastUpdated: number | undefined;
};

type BorrowerMap = {
  [address: string]: Borrower;
};

async function uniqueAddresses(comet: CometInterface): Promise<Set<string>> {
  const transferFilter = comet.filters.Transfer();
  const transferEvents = await comet.queryFilter(transferFilter);
  const addresses = new Set<string>();

  transferEvents.forEach(event => {
    addresses.add(event.args.from);
    addresses.add(event.args.to);
  });

  return addresses;
}

async function buildInitialBorrowerMap(comet: CometInterface): Promise<BorrowerMap> {
  const borrowerMap: BorrowerMap = {};
  const addresses = await uniqueAddresses(comet);

  for (const address of addresses) {
    borrowerMap[address] = {
      address,
      liquidationMargin: undefined,
      lastUpdated: undefined
    };
  }

  return borrowerMap;
}

function shouldCheck(borrower: Borrower) {
  return borrower.lastUpdated == undefined;
}

function generateCandidates(borrowerMap: BorrowerMap): Borrower[] {
  return Object.values(borrowerMap).filter(borrower => shouldCheck(borrower));
}

async function isLiquidatable(comet: CometInterface, borrower: Borrower): Promise<boolean> {
  const liquidationMargin = await comet.getLiquidationMargin(borrower.address);
  return liquidationMargin.lt(0);
}

async function updatedCandidate(hre: HardhatRuntimeEnvironment, comet: CometInterface, borrower: Borrower): Promise<Borrower> {
  const liquidationMargin = await comet.getLiquidationMargin(borrower.address);
  const blockNumber = await hre.ethers.provider.getBlockNumber();

  return {
    address: borrower.address,
    liquidationMargin,
    lastUpdated: blockNumber
  };
}

async function main(config: Config) {
  const { hre } = config;
  const network = hre.network.name;

  const dm = new DeploymentManager(network, hre, {
    writeCacheToDisk: false,
    debug: true,
    verifyContracts: true,
  });
  await dm.spider();

  const contracts = await dm.contracts();
  const comet = contracts.get('comet') as CometInterface;

  const borrowerMap = await buildInitialBorrowerMap(comet);

  while (true) {
    console.log("looping");
    const candidates = generateCandidates(borrowerMap);

    console.log("candidates:");
    console.log(candidates);

    for (const candidate of candidates) {
      borrowerMap[candidate.address] = await updatedCandidate(hre, comet, candidate);

      if (await isLiquidatable(comet, candidate)) {
        console.log("liquidatable: ");
        console.log(candidate);
      } else {
        console.log("not liquidatable: ");
        console.log(candidate);
      }
    }
  }
}

export default main;