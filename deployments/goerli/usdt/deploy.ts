import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { debug, DeploySpec, deployComet, exp, sameAddress, wait } from '../../../src/deploy';

const clone = {
  usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
};

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer();
  const ethers = deploymentManager.hre.ethers;
  const signer = await deploymentManager.getSigner();

  // Clone/fork USDT from mainnet which is non-standard erc20 to testnet
  const USDT = await deploymentManager.clone('USDT', clone.usdt, [100_000_000_000_000, 'Tether USD', 'USDT', 6]);

  // Declare existing assets as aliases
  const COMP = await deploymentManager.existing('COMP', '0x3587b2F7E0E2D6166d6C14230e7Fe160252B0ba4', 'goerli');
  const WBTC = await deploymentManager.existing('WBTC', '0xAAD4992D949f9214458594dF92B44165Fb84dC19', 'goerli');
  const WETH = await deploymentManager.existing('WETH', '0x42a71137C09AE83D8d05974960fd607d40033499', 'goerli');

  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'goerli', 'usdc');
  // Purposely don't use the factory because Comet implementation changed.
  // const cometFactory = await deploymentManager.fromDep('cometFactory', 'goerli', 'usdc');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'goerli', 'usdc');
  const configurator = await deploymentManager.fromDep('configurator', 'goerli', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'goerli', 'usdc');
  const fauceteer = await deploymentManager.fromDep('fauceteer', 'goerli', 'usdc');
  const fxRoot = await deploymentManager.fromDep('fxRoot', 'goerli', 'usdc');
  const bulker = await deploymentManager.fromDep('bulker', 'goerli', 'usdc');
  const timelock = await deploymentManager.fromDep('timelock', 'goerli', 'usdc');


  // Send some forked USDT to timelock
  await deploymentManager.idempotent(
    async () => await USDT.connect(signer).balanceOf(timelock.address) == 0,
    async () => {
      trace(`Sending USDC to timelock`);
      await USDT.connect(signer).transfer(
        timelock.address,
        exp(50_000_000, 6),
      );
      trace(`Sent USDC to timelock completed`);
    }
  );

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);

  return { ...deployed, bulker, fauceteer, fxRoot };
}