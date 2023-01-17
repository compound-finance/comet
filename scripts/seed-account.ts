console.log('before hre')

import hre from 'hardhat';
console.log('after hre')

import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import { sourceTokens } from '../plugins/scenario/utils/TokenSourcer';
import {exp} from '../test/helpers';
import { impersonateAddress } from '../plugins/scenario/utils';

console.log('after hre')

async function main() {
  const network = hre.network.name;

  console.log('running script')

  const dm = new DeploymentManager(
    network,
    'weth',
    hre,
    {
      writeCacheToDisk: true,
    }
  );
  await dm.spider();

  const cbETH = await dm.contract('cbETH');
  const stETH = await dm.contract('stETH');
  // const WETH = await dm.contract('WETH');

  const account1 = "0x1C2C3c2E3232080e0738187520372e30Ce2e34CB";
  const account2 = "0xC26E4A048961b4184EE0892A28c4A075221a0A74";
  await sourceTokens({
    dm,
    amount: exp(100, 18),
    asset: cbETH.address,
    address: account2, // XXX set this
    blacklist: [],
  });

  await sourceTokens({
    dm,
    amount: exp(100, 18),
    asset: stETH.address,
    address: account2, // XXX set this
    blacklist: [],
  });

  await impersonateAddress(dm, account2, exp(100, 18));

  console.log('finished')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
