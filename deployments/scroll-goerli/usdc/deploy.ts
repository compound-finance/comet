import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp, wait } from '../../../src/deploy';

const secondsPerDay = 24 * 60 * 60;

const GOERLI_TIMELOCK = '0x8Fa336EB4bF58Cfc508dEA1B0aeC7336f55B1399'; // L1 contract

export default async function deploy(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  const trace = deploymentManager.tracer();
  const ethers = deploymentManager.hre.ethers;

  // Pull in existing assets
  const WETH = await deploymentManager.existing(
    'WETH',
    '0xa1EA0B2354F5A344110af2b6AD68e75545009a03',
    'scroll-goerli'
  );

  const l2Messenger = await deploymentManager.existing(
    'l2Messenger',
    '0xb75d7e84517e1504C151B270255B087Fd746D34C',
    'scroll-goerli'
  );

  const l2ERC20Gateway = await deploymentManager.existing(
    'l2ERC20Gateway',
    '0xB878F37BB278bf0e4974856fFe86f5e6F66BD725',
    'scroll-goerli'
  );

  const l2ETHGateway = await deploymentManager.existing(
    'l2ETHGateway',
    '0x32139B5C8838E94fFcD83E60dff95Daa7F0bA14c',
    'scroll-goerli'
  );

  const l2WETHGateway = await deploymentManager.existing(
    'l2WETHGateway',
    '0xBb88bF582F2BBa46702621dae5CB9271057bC85b',
    'scroll-goerli'
  );

  // Deploy ScrollBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/scroll/ScrollBridgeReceiver.sol',
    [l2Messenger.address]
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
    l2Messenger,
    l2ERC20Gateway,
    l2ETHGateway,
    l2WETHGateway,
    bulker,
    fauceteer,
  };
}
