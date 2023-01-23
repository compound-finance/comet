console.log('before hre');

import hre from 'hardhat';
console.log('after hre');

import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import { sourceTokens } from '../plugins/scenario/utils/TokenSourcer';
import { exp, fastForward } from '../test/helpers';
import { impersonateAddress } from '../plugins/scenario/utils';

console.log('after hre');

async function main() {
  const network = hre.network.name;

  console.log('running script');

  const dm = new DeploymentManager(network, 'weth', hre, {
    writeCacheToDisk: true
  });
  await dm.spider();

  await fastForward(86_400, dm.hre.ethers);

  // execute proposal first
  console.log('executing proposal');
  const governor = await dm.contract('governor');
  await governor.execute(144);
  console.log('finished executing proposal');

  const account1 = '0x1C2C3c2E3232080e0738187520372e30Ce2e34CB';
  const account2 = '0xC26E4A048961b4184EE0892A28c4A075221a0A74';

  await seedAccount(dm, account1);
  await seedAccount(dm, account2);

  console.log('finished');
}

async function seedAccount(dm, address) {
  const cbETH = await dm.contract('cbETH');
  const stETH = await dm.contract('stETH');

  await sourceTokens({
    dm,
    amount: exp(100, 18),
    asset: cbETH.address,
    address, // XXX set this
    blacklist: []
  });

  await sourceTokens({
    dm,
    amount: exp(100, 18),
    asset: stETH.address,
    address, // XXX set this
    blacklist: []
  });

  await impersonateAddress(dm, address, exp(2000, 18));
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
