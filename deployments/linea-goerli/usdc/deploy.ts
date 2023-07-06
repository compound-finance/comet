import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp, wait } from '../../../src/deploy';

const secondsPerDay = 24 * 60 * 60;

const GOERLI_TIMELOCK = '0x8Fa336EB4bF58Cfc508dEA1B0aeC7336f55B1399';

export default async function deploy(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  const trace = deploymentManager.tracer();
  const ethers = deploymentManager.hre.ethers;

  // Pull in existing assets
  const WETH = await deploymentManager.existing(
    'WETH',
    '0x2C1b868d6596a18e32E61B901E4060C872647b6C',
    'linea-goerli'
  );

  const l2MessageService = await deploymentManager.existing(
    'l2MessageService',
    '0xC499a572640B64eA1C8c194c43Bc3E19940719dC',
    'linea-goerli'
  );

  const l2TokenBridge = await deploymentManager.existing(
    'l2TokenBridge',
    '0xB191E3d98074f92584E5205B99c3F17fB2068927',
    'linea-goerli'
  );

  const l2usdcBridge = await deploymentManager.existing(
    'l2usdcBridge',
    '0x2aeD4D02fD76EeC1580cCDbA158b16F4A0Ad2B60',
    'linea-goerli'
  );

  // Deploy LineaBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/linea/LineaBridgeReceiver.sol',
    [l2MessageService.address]
  );

  // Deploy Local Timelock
  const localTimelock = await deploymentManager.deploy('timelock', 'vendor/Timelock.sol', [
    bridgeReceiver.address, // admin
    10 * 60, // delay
    14 * secondsPerDay, // grace period
    10 * 60, // minimum delay
    30 * secondsPerDay // maximum delay
  ]);

  // Initialize BridgeReceiver
  await deploymentManager.idempotent(
    async () => !(await bridgeReceiver.initialized()),
    async () => {
      trace(`Initializing BridgeReceiver`);
      await bridgeReceiver.initialize(
        GOERLI_TIMELOCK, // govTimelock
        localTimelock.address // localTimelock
      );
      trace(`BridgeReceiver initialized`);
    }
  );

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { comet } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy('bulker', 'bulkers/BaseBulker.sol', [
    await comet.governor(), // admin
    WETH.address // weth
  ]);

  // Deploy fauceteer
  const fauceteer = await deploymentManager.deploy('fauceteer', 'test/Fauceteer.sol', []);

  return {
    ...deployed,
    bridgeReceiver,
    l2MessageService,
    l2TokenBridge,
    bulker,
    fauceteer,
    l2usdcBridge
  };
}
