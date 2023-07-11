import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

const SECONDS_PER_DAY = 24 * 60 * 60;

const GOERLI_TIMELOCK = '0x8Fa336EB4bF58Cfc508dEA1B0aeC7336f55B1399';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer()
  const ethers = deploymentManager.hre.ethers;

  // pull in existing assets
  const USDC = await deploymentManager.existing('USDC', '0x8FB1E3fC51F3b789dED7557E680551d93Ea9d892', 'arbitrum-goerli');
  const LINK = await deploymentManager.existing('LINK', '0xbb7303602be1b9149b097aafb094ffce1860e532', 'arbitrum-goerli');
  const WETH = await deploymentManager.existing('WETH', '0xe39ab88f8a4777030a534146a9ca3b52bd5d43a3', 'arbitrum-goerli');
  const WBTC = await deploymentManager.existing('WBTC', '0x22d5e2dE578677791f6c90e0110Ec629be9d5Fb5', 'arbitrum-goerli');

  // Deploy ArbitrumBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/arbitrum/ArbitrumBridgeReceiver.sol',
    []
  );

  // Deploy Local Timelock
  const localTimelock = await deploymentManager.deploy(
    'timelock',
    'vendor/Timelock.sol',
    [
      bridgeReceiver.address, // admin
      10 * 60,                // delay
      14 * SECONDS_PER_DAY,   // grace period
      10 * 60,                // minimum delay
      30 * SECONDS_PER_DAY    // maximum delay
    ]
  );

  // Initialize ArbitrumBridgeReceiver
  await deploymentManager.idempotent(
    async () => !(await bridgeReceiver.initialized()),
    async () => {
      trace(`Initializing BridgeReceiver`);
      await bridgeReceiver.initialize(
        GOERLI_TIMELOCK,      // govTimelock
        localTimelock.address // localTimelock
      );
      trace(`BridgeReceiver initialized`);
    }
  );

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { comet } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/BaseBulker.sol',
    [
      await comet.governor(), // admin
      WETH.address            // weth
    ]
  );

  return {
    ...deployed,
    bridgeReceiver,
    bulker
  };
}