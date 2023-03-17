import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const GOERLI_TIMELOCK = '0x8Fa336EB4bF58Cfc508dEA1B0aeC7336f55B1399';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer()
  const ethers = deploymentManager.hre.ethers;

  // XXX
  // pull in existing assets
  console.log("geting USDC");
  const USDC = await deploymentManager.existing('USDC', '0x7E07E15D2a87A24492740D16f5bdF58c16db0c4E', 'optimism-goerli');
  // const WBTC = await deploymentManager.existing('WBTC', '0xe0a592353e81a94db6e3226fd4a99f881751776a', 'optimism-goerli');
  console.log("geting WETH");
  const WETH = await deploymentManager.existing('WETH', '0x4200000000000000000000000000000000000006', 'optimism-goerli');

  const l2CrossDomainMessenger = await deploymentManager.existing(
    'l2CrossDomainMessenger',
    ['0xc0d3c0d3c0d3c0d3c0d3c0d3c0d3c0d3c0d30007', '0x4200000000000000000000000000000000000007'],
    'optimism-goerli',
  );

  // Deploy OptimismBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/optimism/OptimismBridgeReceiver.sol',
    [l2CrossDomainMessenger.address],
  );

  // Deploy Local Timelock
  const localTimelock = await deploymentManager.deploy(
    'timelock',
    'vendor/Timelock.sol',
    [
      bridgeReceiver.address, // admin
      1 * DAY,                // delay
      14 * DAY,               // grace period
      12 * HOUR,              // minimum delay
      30 * DAY                // maxiumum delay
    ]
  );

  // Initialize PolygonBridgeReceiver
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

  // Deploy fauceteer
  const fauceteer = await deploymentManager.deploy('fauceteer', 'test/Fauceteer.sol', []);

  return {
    bridgeReceiver,
    l2CrossDomainMessenger,
    bulker,
    fauceteer,
    ...deployed,
  };
}