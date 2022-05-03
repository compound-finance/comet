import { ethers, BigNumber } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { CometInterface } from '../../build/types';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';

type Config = {
  hre: HardhatRuntimeEnvironment;
  loopDelay?: number;
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
    if (address !== ethers.constants.AddressZero) {
      borrowerMap[address] = {
        address,
        liquidationMargin: undefined,
        lastUpdated: undefined
      };
    }
  }

  return borrowerMap;
}

// XXX generate more complex portfolio of candidates
function generateCandidates(borrowerMap: BorrowerMap, blockNumber: number): Borrower[] {
  return Object.values(borrowerMap).filter(borrower => {
    return borrower.lastUpdated == undefined || blockNumber - borrower.lastUpdated > 3;
  });
}

function isLiquidatable(borrower: Borrower): boolean {
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

async function absorbAddress(comet: CometInterface, absorberAddress: string, targetAddress: string) {
  console.log(`attempting to absorb: ${targetAddress}`);
  try {
    await comet.absorb(absorberAddress, [targetAddress]);
    console.log(`successfully absorbed ${targetAddress}`);
  } catch (e) {
    console.log(`absorb failed: ${targetAddress}`);
  }
}

async function main({ hre, loopDelay = 5000}: Config) {
  const network = hre.network.name;
  const [signer] = await hre.ethers.getSigners();
  console.log(`signer.address: ${signer.address}`);

  const dm = new DeploymentManager(network, hre, {
    writeCacheToDisk: false,
    debug: true,
    verifyContracts: true,
  });
  await dm.spider();

  const contracts = await dm.contracts();
  const comet = contracts.get('comet') as CometInterface;

  const borrowerMap = await buildInitialBorrowerMap(comet);

  async function loop() {
    const startingBlockNumber = await hre.ethers.provider.getBlockNumber();
    console.log(`Generating candidates for blockNumber: ${startingBlockNumber}`);
    const candidates = generateCandidates(borrowerMap, startingBlockNumber);

    if (candidates.length == 0) {
      console.log(`0 candidates found for blockNumber: ${startingBlockNumber}; waiting ${loopDelay / 1000} seconds \n`);
      await new Promise(resolve => setTimeout(resolve, loopDelay));
      await loop();
    } else {
      console.log(`${candidates.length} candidates found`);
      for (const candidate of candidates) {
        console.log(`Updating candidate.address: ${candidate.address}`);
        const updatedCandidate = await updateCandidate(hre, comet, candidate);
        borrowerMap[candidate.address] = updatedCandidate;
        console.log(`liquidationMargin: ${updatedCandidate.liquidationMargin}`);

        if (isLiquidatable(updatedCandidate)) {
          console.log(`${updatedCandidate.address} liquidatable`);
          await absorbAddress(comet, signer.address, updatedCandidate.address);
        } else {
          console.log(`${updatedCandidate.address} not liquidatable`);
        }
        console.log("\n");
      }
      await loop();
    }
  }

  await loop();
}

export default main;