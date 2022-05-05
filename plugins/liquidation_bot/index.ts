import ethers, { BigNumber } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { CometInterface } from '../../build/types';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

type Config = {
  hre: HardhatRuntimeEnvironment;
  loopDelay?: number;
};

export type Borrower = {
  address: string;
  liquidationMargin: BigNumber | undefined;
  lastUpdated: number | undefined;
};

export type BorrowerMap = {
  [address: string]: Borrower;
};

function newBorrower(address: string): Borrower {
  return {
    address,
    liquidationMargin: undefined,
    lastUpdated: undefined
  }
}

async function uniqueAddresses(comet: CometInterface): Promise<Set<string>> {
  const withdrawEvents = await comet.queryFilter(comet.filters.Withdraw());
  return new Set(withdrawEvents.map(event => event.args.src));
}

async function buildInitialBorrowerMap(comet: CometInterface): Promise<BorrowerMap> {
  const borrowerMap: BorrowerMap = {};
  const addresses = await uniqueAddresses(comet);

  for (const address of addresses) {
    if (address !== ethers.constants.AddressZero) {
      borrowerMap[address] = newBorrower(address);
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

async function updateCandidate(hre: HardhatRuntimeEnvironment, comet: CometInterface, borrower: Borrower): Promise<Borrower> {
  const liquidationMargin = await comet.getLiquidationMargin(borrower.address);
  const blockNumber = await hre.ethers.provider.getBlockNumber();

  return {
    address: borrower.address,
    liquidationMargin,
    lastUpdated: blockNumber
  };
}

async function attemptAbsorb(comet: CometInterface, absorber: SignerWithAddress, targetAddresses: string[]) {
  if (targetAddresses.length === 0) {
    return [];
  }
  try {
    await comet.connect(absorber).absorb(absorber.address, targetAddresses);
    console.log(`successfully absorbed ${targetAddresses}`);
    return targetAddresses;
  } catch (e) {
    console.log(`absorb failed`);
    return [];
  }
}

function isAbsorbable(borrower: Borrower): boolean {
  return borrower.liquidationMargin.lt(0);
}

type Props = {
  absorber: SignerWithAddress;
  comet: any;
  currentBlock: number;
  lastBlockChecked: number;
  borrowerMap: BorrowerMap;
};

export async function loop({
  comet,
  absorber,
  currentBlock,
  lastBlockChecked,
  borrowerMap
}: Props) {
  // check if you've checked this block previously
  // if (currentBlock <= lastBlockChecked) {
  //   return {
  //     updatedBorrowerMap: borrowerMap
  //   }
  // }

  // attempt absorb
  const absorbableBorrowers = Object.values(borrowerMap).filter(borrower => isAbsorbable(borrower));

  // console.log(`${absorbableBorrowers.length} absorbable borrowers`);

  const absorbedAddresses = await attemptAbsorb(
    comet, absorber, absorbableBorrowers.map(borrower => borrower.address)
  );

  // // attempt to absorb all absorbable accounts
  return {
    updatedBorrowerMap: borrowerMap
  };
}

async function main({ hre, loopDelay = 5000}: Config) {
  const network = hre.network.name;
  const [signer] = await hre.ethers.getSigners();

  const dm = new DeploymentManager(network, hre, {
    writeCacheToDisk: false,
    debug: true,
    verifyContracts: true,
  });
  await dm.spider();

  const contracts = await dm.contracts();
  const comet = contracts.get('comet') as CometInterface;

  let borrowerMap = await buildInitialBorrowerMap(comet);
  let lastBlockChecked = 0;

  while (true) {
    const currentBlock = await hre.ethers.provider.getBlockNumber();
    const { updatedBorrowerMap } = await loop(currentBlock, lastBlockChecked, borrowerMap);
    lastBlockChecked = currentBlock;
    borrowerMap = updatedBorrowerMap; // XXX do atomically

    console.log(`running for block ${startingBlockNumber}`);

    // generate candidates
    const candidates = generateCandidates(borrowerMap, startingBlockNumber);

    console.log(`updating ${candidates.length} candidates`);

    // update candidates
    for (const candidate of candidates) {
      const updatedCandidate = await updateCandidate(hre, comet, candidate);
      borrowerMap[candidate.address] = updatedCandidate;
      console.log({address: updatedCandidate.address, liquidationMargin: updatedCandidate.liquidationMargin});
    }

    // attempt absorb
    const absorbableBorrowers = Object.values(borrowerMap).filter(borrower => isAbsorbable(borrower));

    console.log(`${absorbableBorrowers.length} absorbable borrowers`);

    const absorbedAddresses = await attemptAbsorb(comet, signer.address, absorbableBorrowers.map(borrower => borrower.address));

    console.log(`${absorbedAddresses.length} borrowers absorbed`);

    for (const address of absorbedAddresses) {
      // clear info for absorbed addresses
      borrowerMap[address] = newBorrower(address);
    }

    lastBlock = startingBlockNumber;
  }
}

export default main;