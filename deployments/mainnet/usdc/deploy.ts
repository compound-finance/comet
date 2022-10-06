import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const USDC = await deploymentManager.existing('USDC', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  const WBTC = await deploymentManager.existing('WBTC', '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599');
  const WETH = await deploymentManager.existing('WETH', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
  const COMP = await deploymentManager.existing('COMP', '0xc00e94cb662c3520282e6f5717214004a7f26888');
  const LINK = await deploymentManager.existing('LINK', '0x514910771af9ca656af840dff83e8264ecf986ca');
  const UNI = await deploymentManager.existing('UNI', '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984');

  // Mainnet -> Polygon bridge contract
  const fxRoot = await deploymentManager.existing('fxRoot', '0xfe5e5D361b2ad62c541bAb87C45a0B9B018389a2');

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { comet } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'Bulker.sol',
    [await comet.governor(), WETH.address]
  );

  return { ...deployed, bulker, fxRoot };
}
