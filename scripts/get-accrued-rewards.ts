import hre from 'hardhat';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import { CometInterface, CometRewards } from '../build/types';
import { BigNumber } from 'ethers';
import { requireEnv } from '../hardhat.config';

type AddressAndRewardOwed = {
  address: string;
  owed: BigNumber;
}

// Pulls in all addresses that have supplied or borrowed the base asset from Comet
async function getUniqueAddresses(comet: CometInterface): Promise<Set<string>> {
  const withdrawEvents = await comet.queryFilter(comet.filters.Withdraw());
  const supplyEvents = await comet.queryFilter(comet.filters.Supply());
  return new Set(withdrawEvents.map(e => e.args.src).concat(supplyEvents.map(e => e.args.dst)));
}

async function main() {
  const network = hre.network.name;
  const DEPLOYMENT = requireEnv('DEPLOYMENT');
  const BLOCK_NUMBER = requireEnv('BLOCK_NUMBER');
  const blockTag = { blockTag: BLOCK_NUMBER === undefined ? 'latest' : parseInt(BLOCK_NUMBER) };

  const dm = new DeploymentManager(network, DEPLOYMENT, hre);

  await dm.spider();
  const comet = await dm.contract('comet') as CometInterface;
  const rewards = await dm.contract('rewards') as CometRewards;

  const uniqueAddresses = await getUniqueAddresses(comet);

  const addressesAndRewardOwed: AddressAndRewardOwed[] = [];

  for (const address of uniqueAddresses) {
    const rewardOwed = await rewards.callStatic.getRewardOwed(comet?.address, address, blockTag);
    addressesAndRewardOwed.push({
      address: address,
      owed: rewardOwed?.owed
    });
  }

  console.log(`✨ Fetched accrued rewards for ${addressesAndRewardOwed.length} accounts`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
