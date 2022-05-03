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

// XXX generate more complex portfolio of candidates
function generateCandidates(borrowerMap: BorrowerMap, blockNumber: number): Borrower[] {
  return Object.values(borrowerMap).filter(borrower => {
    return borrower.lastUpdated == undefined || blockNumber - borrower.lastUpdated > 3;
  });
}

async function isLiquidatable(borrower: Borrower): Promise<boolean> {
  return borrower.liquidationMargin.lt(0);
}

async function updateCandidate(hre: HardhatRuntimeEnvironment, comet: CometInterface, borrower: Borrower): Promise<Borrower> {
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

  // while (true) {
  //   const startingBlockNumber = await hre.ethers.provider.getBlockNumber();
  //   console.log(`looping; blockNumber: ${startingBlockNumber}`);
  //   const candidates = generateCandidates(borrowerMap, startingBlockNumber);

  //   console.log(`${candidates.length} candidates: `);
  //   console.log(candidates);

  //   for (const candidate of candidates) {
  //     const updatedCandidate = await updateCandidate(hre, comet, candidate);
  //     borrowerMap[candidate.address] = updatedCandidate;

  //     if (isLiquidatable(updatedCandidate)) {
  //       console.log("liquidatable: ");
  //       console.log(updatedCandidate);
  //     } else {
  //       console.log("not liquidatable: ");
  //       console.log(updatedCandidate);
  //     }
  //   }
  // }

  async function loop() {

    const startingBlockNumber = await hre.ethers.provider.getBlockNumber();
    console.log(`looping; blockNumber: ${startingBlockNumber}`);
    const candidates = generateCandidates(borrowerMap, startingBlockNumber);

    console.log(`${candidates.length} candidates: `);
    console.log(candidates);

    if (candidates.length == 0) {
      console.log("no candidates; waiting X seconds");
      // setTimeout(async () => await loop(), 10000);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await loop();
    } else {
      for (const candidate of candidates) {
        const updatedCandidate = await updateCandidate(hre, comet, candidate);
        borrowerMap[candidate.address] = updatedCandidate;

        if (isLiquidatable(updatedCandidate)) {
          console.log("liquidatable: ");
          console.log(updatedCandidate);
        } else {
          console.log("not liquidatable: ");
          console.log(updatedCandidate);
        }
      }
      await loop();
    }
  }

  await loop();
}

export default main;