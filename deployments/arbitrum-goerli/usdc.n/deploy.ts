import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

const SECONDS_PER_DAY = 24 * 60 * 60;

const GOERLI_TIMELOCK = '0x8Fa336EB4bF58Cfc508dEA1B0aeC7336f55B1399';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer()
  const ethers = deploymentManager.hre.ethers;

  // pull in existing assets
  const USDC = await deploymentManager.existing('USDC', '0xfd064A18f3BF249cf1f87FC203E90D8f650f2d63', 'arbitrum-goerli');
  const LINK = await deploymentManager.existing('LINK', '0xbb7303602be1b9149b097aafb094ffce1860e532', 'arbitrum-goerli');
  const WETH = await deploymentManager.existing('WETH', '0xe39ab88f8a4777030a534146a9ca3b52bd5d43a3', 'arbitrum-goerli');
  const WBTC = await deploymentManager.existing('WBTC', '0x22d5e2dE578677791f6c90e0110Ec629be9d5Fb5', 'arbitrum-goerli');
  const arbitrumCCTPTokenMinter = await deploymentManager.existing('arbitrumCCTPTokenMinter', '0xE997d7d2F6E065a9A93Fa2175E878Fb9081F1f0A', 'arbitrum-goerli');

  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'arbitrum-goerli', 'usdc');
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'arbitrum-goerli', 'usdc');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'arbitrum-goerli', 'usdc');
  const configurator = await deploymentManager.fromDep('configurator', 'arbitrum-goerli', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'arbitrum-goerli', 'usdc');
  const bulker = await deploymentManager.fromDep('bulker', 'arbitrum-goerli', 'usdc');
  const localTimelock = await deploymentManager.fromDep('timelock', 'arbitrum-goerli', 'usdc');
  const bridgeReceiver = await deploymentManager.fromDep('bridgeReceiver', 'arbitrum-goerli', 'usdc');

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);

  return {
    ...deployed,
    bridgeReceiver,
    bulker, 
    rewards,
    arbitrumCCTPTokenMinter
  };
}
