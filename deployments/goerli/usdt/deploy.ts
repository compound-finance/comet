import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { debug, DeploySpec, deployComet, exp, sameAddress, wait } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const ethers = deploymentManager.hre.ethers;
  const signer = await deploymentManager.getSigner();

  // Declare existing assets as aliases
  const USDT = await deploymentManager.existing('USDT', '0x79C950C7446B234a6Ad53B908fBF342b01c4d446', 'goerli');
  const COMP = await deploymentManager.existing('COMP', '0x3587b2F7E0E2D6166d6C14230e7Fe160252B0ba4', 'goerli');
  const WBTC = await deploymentManager.existing('WBTC', '0xAAD4992D949f9214458594dF92B44165Fb84dC19', 'goerli');
  const WETH = await deploymentManager.existing('WETH', '0x42a71137C09AE83D8d05974960fd607d40033499', 'goerli');

  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'goerli', 'usdc');
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'goerli', 'usdc');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'goerli', 'usdc');
  const configurator = await deploymentManager.fromDep('configurator', 'goerli', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'goerli', 'usdc');
  const fauceteer = await deploymentManager.fromDep('fauceteer', 'goerli', 'usdc');
  const fxRoot = await deploymentManager.fromDep('fxRoot', 'goerli', 'usdc');
  const bulker = await deploymentManager.fromDep('bulker', 'goerli', 'usdc');
  const timelock = await deploymentManager.fromDep('timelock', 'goerli', 'usdc');

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);
  return { ...deployed, bulker, fauceteer, fxRoot };
}