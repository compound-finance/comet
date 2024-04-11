import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

const MAINNET_TIMELOCK = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const ezETH = await deploymentManager.existing('ezETH', '0xbf5495Efe5DB9ce00f80364C8B423567e58d2110');
  const WETH = await deploymentManager.existing('WETH', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');

  const wethConstantPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,                                             // decimals
      exp(1, 8)                                      // constantPrice
    ]
  );

  // Deploy scaling price feed for ezETH
  const ezETHScalingPriceFeed = await deploymentManager.deploy(
    'ezETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x636A000262F6aA9e1F094ABF0aD8f645C44f641C', // ezETH / ETH price feed
      8                                             // decimals
    ]
  );

  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'mainnet', 'usdc');
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'mainnet', 'usdc');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'mainnet', 'usdc');
  const configurator = await deploymentManager.fromDep('configurator', 'mainnet', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'mainnet', 'usdc');
  const bulker = await deploymentManager.fromDep('bulker', 'mainnet', 'usdc'); // 0xa397a8C2086C554B531c02E29f3291c9704B00c7
  const localTimelock = await deploymentManager.fromDep('timelock', 'mainnet', 'usdc');
  
  await deploymentManager.hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [MAINNET_TIMELOCK],
  });
  const adminSigner = await deploymentManager.hre.ethers.getSigner(MAINNET_TIMELOCK);
  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec, {}, adminSigner);

  return { ...deployed, bulker };
}
