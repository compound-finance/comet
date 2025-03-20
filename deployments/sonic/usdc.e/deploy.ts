import {
  Deployed,
  DeploymentManager,
} from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const MAINNET_TIMELOCK = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925';

export default async function deploy(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  return deployed;
}

async function deployContracts(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  const trace = deploymentManager.tracer();

  const _USDC = await deploymentManager.existing('USDC.e', '0x29219dd400f2Bf60E5a23d13Be72B486D4038894', 'sonic');
  const WS = await deploymentManager.existing('wS', '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38', 'sonic');
  const _stS = await deploymentManager.existing('stS', '0xE5DA20F15420aD15DE0fa650600aFc998bbE3955', 'sonic');

  const _stSPriceFeed = await deploymentManager.deploy(
    'stS:priceFeed',
    'pricefeeds/PriceFeedWith4626Support.sol',
    [
      '0xE5DA20F15420aD15DE0fa650600aFc998bbE3955', // sUSDS / USD price feed
      '0xc76dFb89fF298145b417d221B2c747d84952e01d', // USDS / USD price feed
      8,                                            // decimals
      'stS / USD price feed',                       // description
    ],
    true
  );
  
  const l2CCIPRouter = await deploymentManager.existing(
    'l2CCIPRouter',
    '0xB4e1Ff7882474BB93042be9AD5E1fA387949B860',
    'sonic'
  );
  const l2CCIPOffRamp = await deploymentManager.existing(
    'l2CCIPOffRamp',
    '0x7c6963669EBFf136EE36c053EcF0089d59eE2287',
    'sonic'
  );
  const l2SonicBridge = await deploymentManager.existing(
    'l2SonicBridge',
    '0x9Ef7629F9B930168b76283AdD7120777b3c895b3',
    'sonic'
  );

  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/ronin/RoninBridgeReceiver.sol',
    [l2CCIPRouter.address]
  );

  const localTimelock = await deploymentManager.deploy(
    'timelock',
    'vendor/Timelock.sol',
    [
      bridgeReceiver.address,
      1 * DAY,
      14 * DAY,
      12 * HOUR,
      30 * DAY,
    ]
  );

  // Initialize SonicBridgeReceiver
  await deploymentManager.retry(() => {
    return deploymentManager.idempotent(
      async () => !(await bridgeReceiver.initialized()),
      async () => {
        trace(`Initializing BridgeReceiver`);
        await bridgeReceiver.initialize(
          MAINNET_TIMELOCK,     // govTimelock
          localTimelock.address // localTimelock
        );
        trace(`BridgeReceiver initialized`);
      }
    );
  });

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec, {}, true);
  const { comet } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/BaseBulker.sol',
    [
      await comet.governor(), // admin
      WS.address, // weth
    ]
  );

  return {
    ...deployed,
    bridgeReceiver,
    l2CCIPRouter,
    l2CCIPOffRamp,
    l2SonicBridge,
    bulker,
    localTimelock,
  };
}