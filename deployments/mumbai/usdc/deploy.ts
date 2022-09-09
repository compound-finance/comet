import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, cloneGov, deployComet, exp, sameAddress, wait } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  // XXX mint tokens
  return deployed;
}

async function deployContracts(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer()
  const ethers = deploymentManager.hre.ethers;
  const signer = await deploymentManager.getSigner();

  // Deploy PolygonBridgeReceiver
  const polygonBridgeReceiver = await deploymentManager.deploy(
    'polygonBridgeReceiver',
    'bridges/polygon/PolygonBridgeReceiver.sol',
    [
      signer.address, // admin
    ]
  );

  // Deploy BridgeTimelock
  const bridgeTimelock = await deploymentManager.deploy(
    'bridgeTimelock',
    'bridges/BridgeTimelock.sol',
    [
      polygonBridgeReceiver.address, // admin
      2 * 24 * 60 * 60 // delay (min of 2 days)
    ]
  );

  // https://docs.polygon.technology/docs/develop/l1-l2-communication/fx-portal/#contract-addresses
  const FX_CHILD = "0xCf73231F28B7331BBe3124B907840A94851f9f11"; //
  const MAINNET_TIMELOCK = "0x6d903f6003cca6255d85cca4d3b5e5146dc33925";

  // Initialize PolygonBridgeReceiver
  trace(`Initializing PolygonBridgeReceiver`);
  await polygonBridgeReceiver.initialize(
    MAINNET_TIMELOCK, // mainnet timelock
    bridgeTimelock.address, // l2 timelock
    FX_CHILD // fxChild
  );
  trace(`PolygonBridgeReceiver initialized`);

  // Deploy Comet
  // const deployed = await deployComet(
  //   deploymentManager,
  //   deploySpec,
  //   {
  //     governor: bridgeTimelock.address
  //   }
  // );

  // deploy bulker
  // deploy fauceteer
  // mint tokens

  return {
    bridgeTimelock,
    polygonBridgeReceiver,
    // ...deployed
  };
}