import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer()
  const ethers = deploymentManager.hre.ethers;

  // pull in existing assets
  const USDT = await deploymentManager.existing('USDT', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 'polygon');
  const WBTC = await deploymentManager.existing('WBTC', '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', 'polygon');
  const WETH = await deploymentManager.existing('WETH', '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', 'polygon');
  const WMATIC = await deploymentManager.existing('WMATIC', '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', 'polygon');
  const MaticX = await deploymentManager.existing('MaticX', '0xfa68FB4628DFF1028CFEc22b4162FCcd0d45efb6', 'polygon');
  const stMATIC = await deploymentManager.existing('stMATIC', '0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4', 'polygon');
  const COMP = await deploymentManager.existing('COMP', '0x8505b9d2254A7Ae468c0E9dd10Ccea3A837aef5c', 'polygon');

  const fxChild = await deploymentManager.existing('fxChild', '0x8397259c983751DAf40400790063935a11afa28a', 'polygon');

  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'polygon', 'usdc');
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'polygon', 'usdc');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'polygon', 'usdc');
  const configurator = await deploymentManager.fromDep('configurator', 'polygon', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'polygon', 'usdc');
  const bulker = await deploymentManager.fromDep('bulker', 'polygon', 'usdc');
  const localTimelock = await deploymentManager.fromDep('timelock', 'polygon', 'usdc');
  const bridgeReceiver = await deploymentManager.fromDep('bridgeReceiver', 'polygon', 'usdc');

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);

  return {
    ...deployed,
    bridgeReceiver, 
    bulker,
    fxChild,
    rewards,
    COMP
  };
}