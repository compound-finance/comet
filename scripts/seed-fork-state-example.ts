import hre from 'hardhat';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import { exp } from '../test/helpers';
import { impersonateAddress } from '../plugins/scenario/utils';
import { setNextBaseFeeToZero } from '../scenario/utils/hreUtils';
import { getConfigurationStruct } from '../src/deploy';
import { requireEnv } from '../hardhat.config';

// Instructions before running:
// 1. Set the `url` (RPC url) for your target network in `hardhat.config.ts` to your EthForks URL.
// 2. Run `DEPLOYMENT=<e.g. usdc> ACCOUNT=<YOUR_ACCOUNT> REMOTE_ACCOUNTS=true npx hardhat run scripts/seed-fork-state-example.ts --network <YOUR_NETWORK>>`
async function main() {
  const DEPLOYMENT = requireEnv('DEPLOYMENT');
  const ACCOUNT = requireEnv('ACCOUNT');

  const network = hre.network.name;

  const dm = new DeploymentManager(network, DEPLOYMENT, hre, {
    writeCacheToDisk: true
  });
  await dm.spider();

  // Execute actions in cross-chain Polygon proposal
  await executeCrossChainProposalActions(dm);

  await seedAccount(dm, ACCOUNT);

  console.log('Finished!');
}

async function seedAccount(dm, address) {
  const WHALE_TO_STEAL_FROM = '0xfffbcd322ceace527c8ec6da8de2461c6d9d4e6e';
  const account = await impersonateAddress(dm, WHALE_TO_STEAL_FROM);

  const usdc = await dm.contract('USDC');
  const matic = await dm.contract('WMATIC');

  await usdc.connect(account).transfer(address, exp(10_000, 6));
  await matic.connect(account).transfer(address, exp(50_000, 18));
  // Note: We temporarily try-catch this call because it seems like Forkcade returns an error for this
  // txn despite processing it succesfully.
  try {
    await account.sendTransaction({ to: address, value: exp(10_000, 18) });
  } catch (e) {
    console.log(e);
  }
  console.log('---account', account);
  console.log('matic', await usdc.balanceOf(address), await matic.balanceOf(address));
}

async function executeCrossChainProposalActions(dm) {
  const { comet, cometAdmin, configurator } = await dm.getContracts();
  const configuration = await getConfigurationStruct(dm);

  // We can also fast forward time like this:
  // await fastForward(86_400, dm.hre.ethers);

  // Impersonate the local timelock
  await setNextBaseFeeToZero(dm);
  const timelock = await impersonateAddress(dm, '0xCC3E7c85Bb0EE4f09380e041fee95a0caeDD4a02');

  // Update supply cap
  await setNextBaseFeeToZero(dm);
  await configurator
    .connect(timelock)
    .setConfiguration(comet.address, configuration, { gasPrice: 0 });

  // Upgrade comet
  await setNextBaseFeeToZero(dm);
  await cometAdmin
    .connect(timelock)
    .deployAndUpgradeTo(configurator.address, comet.address, { gasPrice: 0 });
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
